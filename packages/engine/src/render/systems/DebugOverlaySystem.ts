import * as THREE from 'three/webgpu';
import { createDebugOverlayMaterialTSL } from '../materials/DebugOverlayMaterialTSL';
import type { DebugOverlay } from '@terraforming/types';
import type { FluidSystem } from '../../sim/FluidSystem';

export interface DebugOverlaySystemOptions {
  scene: THREE.Scene;
  terrainSize: number;
  fluidSystem: FluidSystem;
}

export class DebugOverlaySystem {
  private scene: THREE.Scene;
  private terrainSize: number;
  private fluidSystem: FluidSystem;
  private gridSize: number = 256; // Default grid size

  // Overlay meshes
  private overlayMeshes: Map<DebugOverlay, THREE.Mesh> = new Map();
  private activeOverlays: Set<DebugOverlay> = new Set();

  constructor(options: DebugOverlaySystemOptions) {
    this.scene = options.scene;
    this.terrainSize = options.terrainSize;
    this.fluidSystem = options.fluidSystem;
  }

  /**
   * Create an overlay mesh for a specific debug type
   */
  private createOverlayMesh(type: DebugOverlay): THREE.Mesh | undefined {
    let overlayTexture: GPUTexture | null = null;

    // Get the appropriate texture from fluid system
    switch (type) {
      case 'flow':
        overlayTexture = this.fluidSystem.getFlowTexture();
        break;
      case 'accumulation':
        overlayTexture = this.fluidSystem.getFlowAccumulationTexture?.() ?? null;
        break;
      case 'pools':
        overlayTexture = this.fluidSystem.getPoolMaskTexture?.() ?? null;
        break;
      case 'waterDepth':
        overlayTexture = this.fluidSystem.getWaterDepthTexture();
        break;
      case 'sediment':
        overlayTexture = this.fluidSystem.getSedimentTexture();
        break;
      case 'temperature':
        overlayTexture = this.fluidSystem.getTemperatureTexture?.() ?? null;
        break;
      case 'height':
        // Height would come from terrain renderer
        return undefined;
      case 'erosion':
        // Erosion visualization would need erosion rate texture
        return undefined;
      case 'lava':
        overlayTexture = this.fluidSystem.getLavaDepthTexture?.() ?? null;
        break;
      case 'contours':
        // Contours are handled by terrain material directly
        return undefined;
      default:
        return undefined;
    }

    if (!overlayTexture) {
      console.warn(`DebugOverlaySystem: No texture available for overlay type: ${type}`);
      return undefined;
    }

    // Create a placeholder DataTexture for WebGPU compatibility
    const size = this.gridSize;
    const channels = type === 'flow' ? 2 : 1;
    const data = new Float32Array(size * size * channels);
    const threeTexture = new THREE.DataTexture(
      data,
      size,
      size,
      type === 'flow' ? THREE.RGFormat : THREE.RedFormat,
      THREE.FloatType
    );

    // Mark as GPU texture and attach the actual GPU texture
    (threeTexture as any).isStorageTexture = true;
    (threeTexture as any).gpuTexture = overlayTexture;
    threeTexture.minFilter = THREE.LinearFilter;
    threeTexture.magFilter = THREE.LinearFilter;
    threeTexture.wrapS = THREE.ClampToEdgeWrapping;
    threeTexture.wrapT = THREE.ClampToEdgeWrapping;
    threeTexture.needsUpdate = false; // Don't update CPU data

    // Create overlay plane geometry
    const geometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      1,
      1
    );
    geometry.rotateX(-Math.PI / 2);

    // Create material
    const material = createDebugOverlayMaterialTSL({
      overlayTexture: threeTexture,
      overlayType: type as any,
      opacity: 0.7
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.5; // Slightly above terrain
    mesh.renderOrder = 10; // Render after terrain
    mesh.visible = false; // Start hidden

    return mesh;
  }

  /**
   * Set active debug overlays
   */
  public setOverlays(overlays: DebugOverlay[]): void {
    // Hide all current overlays
    this.overlayMeshes.forEach(mesh => {
      mesh.visible = false;
    });
    this.activeOverlays.clear();

    // Process new overlays
    for (const overlay of overlays) {
      if (overlay === 'contours') {
        // Contours are handled by terrain material
        continue;
      }

      // Get or create mesh for this overlay
      let mesh = this.overlayMeshes.get(overlay);
      if (!mesh) {
        mesh = this.createOverlayMesh(overlay);
        if (mesh) {
          this.overlayMeshes.set(overlay, mesh);
          this.scene.add(mesh);
        }
      }

      if (mesh) {
        mesh.visible = true;
        this.activeOverlays.add(overlay);
      }
    }
  }

  /**
   * Update overlay textures (called each frame)
   */
  public update(): void {
    // Update texture references for active overlays
    for (const overlay of this.activeOverlays) {
      const mesh = this.overlayMeshes.get(overlay);
      if (!mesh) continue;

      // Get current texture (handles ping-pong buffers)
      let currentTexture: GPUTexture | null = null;

      switch (overlay) {
        case 'flow':
          currentTexture = this.fluidSystem.getFlowTexture();
          break;
        case 'waterDepth':
          currentTexture = this.fluidSystem.getWaterDepthTexture();
          break;
        case 'sediment':
          currentTexture = this.fluidSystem.getSedimentTexture();
          break;
        // Add other dynamic textures as needed
      }

      if (currentTexture) {
        // Create a placeholder DataTexture for WebGPU compatibility
        const size = this.gridSize;
        const channels = overlay === 'flow' ? 2 : 1;
        const data = new Float32Array(size * size * channels);
        const threeTexture = new THREE.DataTexture(
          data,
          size,
          size,
          overlay === 'flow' ? THREE.RGFormat : THREE.RedFormat,
          THREE.FloatType
        );

        // Mark as GPU texture and attach the actual GPU texture
        (threeTexture as any).isStorageTexture = true;
        (threeTexture as any).gpuTexture = currentTexture;
        threeTexture.needsUpdate = false; // Don't update CPU data

        // Recreate material with new texture
        mesh.material = createDebugOverlayMaterialTSL({
          overlayTexture: threeTexture,
          overlayType: overlay as any,
          opacity: 0.7
        });
      }
    }
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.overlayMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.overlayMeshes.clear();
    this.activeOverlays.clear();
  }
}
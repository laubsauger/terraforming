import * as THREE from 'three/webgpu';

export interface EmitterSource {
  id: string;
  type: 'water' | 'lava';
  position: THREE.Vector3;
  flowRate: number; // units per second
  active: boolean;
  mesh?: THREE.Mesh; // Visual representation
}

export interface SourceEmitterManagerOptions {
  scene: THREE.Scene;
}

export class SourceEmitterManager {
  private scene: THREE.Scene;
  private sources: Map<string, EmitterSource>;
  private sourceGroup: THREE.Group;
  private nextId: number = 1;
  private showVisualIndicators: boolean = true;

  constructor(options: SourceEmitterManagerOptions) {
    this.scene = options.scene;
    this.sources = new Map();

    // Create a group to hold all source visualizations
    this.sourceGroup = new THREE.Group();
    this.sourceGroup.name = 'SourceEmitters';
    this.scene.add(this.sourceGroup);
  }

  /**
   * Add a new water or lava source at the specified position
   */
  public addSource(position: THREE.Vector3, type: 'water' | 'lava', flowRate: number = 10): string {
    const id = `source_${this.nextId++}`;

    // Create visual representation
    const mesh = this.createSourceMesh(type);
    mesh.position.copy(position);
    this.sourceGroup.add(mesh);

    const source: EmitterSource = {
      id,
      type,
      position: position.clone(),
      flowRate,
      active: true,
      mesh
    };

    this.sources.set(id, source);

    console.log(`Added ${type} source at position:`, position);
    return id;
  }

  /**
   * Create visual mesh for a source
   */
  private createSourceMesh(type: 'water' | 'lava'): THREE.Mesh {
    // Create a geyser/fountain-like visualization
    const group = new THREE.Group() as any;

    // Base marker - a glowing sphere (keeping this unique part)
    const baseGeometry = new THREE.SphereGeometry(0.5, 16, 16);
    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: type === 'water' ? 0x0099cc : 0xff4500,
      emissive: type === 'water' ? 0x0066aa : 0xff2200,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.2,
      transparent: true,
      opacity: 0.8
    });
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    group.add(baseMesh);

    // Fountain effect - animated particle system simulation (keeping this unique part)
    const fountainGeometry = new THREE.ConeGeometry(0.3, 2, 8);
    const fountainMaterial = new THREE.MeshPhysicalMaterial({
      color: type === 'water' ? 0x4db8ff : 0xffa500,
      emissive: type === 'water' ? 0x0088cc : 0xff6600,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    const fountain = new THREE.Mesh(fountainGeometry, fountainMaterial);
    fountain.position.y = 1;
    group.add(fountain);

    // Add pulsing rings for visual effect - consistent with hover overlay
    for (let i = 0; i < 3; i++) {
      const ringRadius = 0.8 + i * 0.4;
      const ringGeometry = new THREE.RingGeometry(ringRadius, ringRadius + 0.1, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: type === 'water' ? 0x0099cc : 0xff4500,
        transparent: true,
        opacity: 0.3 - i * 0.1,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      // Store ring index and base values for animation
      ring.userData.ringIndex = i;
      ring.userData.baseRadius = ringRadius;
      ring.userData.baseOpacity = 0.3 - i * 0.1;
      group.add(ring);
    }

    // Store rings array for animation
    group.userData.rings = group.children.slice(2); // Rings start at index 2
    group.userData.sourceType = type;
    return group as any;
  }

  /**
   * Remove a source by ID
   */
  public removeSource(id: string): boolean {
    const source = this.sources.get(id);
    if (!source) return false;

    if (source.mesh) {
      this.sourceGroup.remove(source.mesh);
      // Dispose of geometries and materials
      source.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    this.sources.delete(id);
    return true;
  }

  /**
   * Get all active sources
   */
  public getActiveSources(): EmitterSource[] {
    return Array.from(this.sources.values()).filter(s => s.active);
  }

  /**
   * Get sources by type
   */
  public getSourcesByType(type: 'water' | 'lava'): EmitterSource[] {
    return Array.from(this.sources.values()).filter(s => s.type === type && s.active);
  }

  /**
   * Toggle source active state
   */
  public toggleSource(id: string): void {
    const source = this.sources.get(id);
    if (source) {
      source.active = !source.active;
      if (source.mesh) {
        source.mesh.visible = source.active;
      }
    }
  }

  /**
   * Set visibility of all source indicators
   */
  public setVisualIndicatorsVisible(visible: boolean): void {
    this.showVisualIndicators = visible;
    this.sourceGroup.visible = visible;
  }

  /**
   * Update animations for all sources
   */
  public update(deltaTime: number): void {
    const time = Date.now() * 0.001;

    this.sources.forEach((source) => {
      if (!source.mesh || !source.active) return;

      const group = source.mesh as any;

      // Animate the base sphere - gentle pulsing
      const baseMesh = group.children[0] as THREE.Mesh;
      if (baseMesh) {
        baseMesh.scale.setScalar(1 + Math.sin(time * 3) * 0.1);
      }

      // Animate fountain - vertical oscillation
      const fountain = group.children[1] as THREE.Mesh;
      if (fountain) {
        fountain.position.y = 1 + Math.sin(time * 2) * 0.2;
        fountain.scale.y = 1 + Math.sin(time * 4) * 0.2;
        fountain.rotation.y = time * 0.5;
      }

      // Animate rings - expanding ripples (consistent with hover animation)
      const rings = group.userData.rings as THREE.Mesh[];
      if (rings) {
        rings.forEach((ring, index) => {
          const phase = index * 0.3;
          const animTime = (time + phase) % 2; // 2 second cycle

          // Expand and fade out
          const scale = 1 + animTime * 0.5;
          ring.scale.setScalar(scale);

          // Fade opacity
          const baseOpacity = ring.userData.baseOpacity || 0.3;
          const opacity = Math.max(0, baseOpacity * (1 - animTime / 2));
          (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
        });
      }
    });
  }

  /**
   * Get source data for simulation (positions and flow rates)
   */
  public getSourceDataForSimulation(): {
    waterSources: { position: THREE.Vector3; flowRate: number }[],
    lavaSources: { position: THREE.Vector3; flowRate: number }[]
  } {
    const waterSources = this.getSourcesByType('water').map(s => ({
      position: s.position,
      flowRate: s.flowRate
    }));

    const lavaSources = this.getSourcesByType('lava').map(s => ({
      position: s.position,
      flowRate: s.flowRate
    }));

    return { waterSources, lavaSources };
  }

  /**
   * Clear all sources
   */
  public clearAll(): void {
    this.sources.forEach((source) => {
      if (source.mesh) {
        this.sourceGroup.remove(source.mesh);
        source.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
      }
    });
    this.sources.clear();
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this.clearAll();
    this.scene.remove(this.sourceGroup);
  }
}
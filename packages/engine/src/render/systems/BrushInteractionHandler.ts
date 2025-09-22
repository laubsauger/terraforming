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
        this.brushSystem.addBrushOp(
          this.brushMode,
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
    const rayOrigin = this.camera.position.clone();
    const rayDir = new THREE.Vector3();
    rayDir.subVectors(baseHit, rayOrigin).normalize();

    const maxSteps = 100;
    const startDistance = Math.max(0, rayOrigin.distanceTo(baseHit) - 20);
    const marchDistance = rayOrigin.distanceTo(baseHit) + 20;
    let closestPoint = baseHit.clone();
    let minDistToSurface = Infinity;
    let foundHit = false;
    let stepSize = (marchDistance - startDistance) / 20;

    for (let i = 0; i < maxSteps && !foundHit; i++) {
      const t = startDistance + i * stepSize;
      if (t > marchDistance) break;

      const samplePoint = new THREE.Vector3();
      samplePoint.copy(rayOrigin).addScaledVector(rayDir, t);

      const actualHeight = this.getHeightAtWorldPos?.(samplePoint.x, samplePoint.z) ?? 0;
      const rayHeight = samplePoint.y;

      if (rayHeight <= actualHeight) {
        let low = Math.max(startDistance, t - stepSize);
        let high = t;

        for (let j = 0; j < 10; j++) {
          const mid = (low + high) / 2;
          const testPoint = new THREE.Vector3();
          testPoint.copy(rayOrigin).addScaledVector(rayDir, mid);

          const testHeight = this.getHeightAtWorldPos?.(testPoint.x, testPoint.z) ?? 0;

          if (Math.abs(testPoint.y - testHeight) < 0.1) {
            return new THREE.Vector3(testPoint.x, testHeight, testPoint.z);
          }

          if (testPoint.y > testHeight) {
            low = mid;
          } else {
            high = mid;
          }
        }

        const finalPoint = new THREE.Vector3();
        finalPoint.copy(rayOrigin).addScaledVector(rayDir, (low + high) / 2);
        const finalHeight = this.getHeightAtWorldPos?.(finalPoint.x, finalPoint.z) ?? 0;
        return new THREE.Vector3(finalPoint.x, finalHeight, finalPoint.z);
      }

      const distToSurface = Math.abs(rayHeight - actualHeight);
      if (distToSurface < minDistToSurface) {
        minDistToSurface = distToSurface;
        closestPoint.set(samplePoint.x, actualHeight, samplePoint.z);

        if (distToSurface < 5) {
          stepSize = Math.min(stepSize, 0.5);
        }
      }
    }

    return closestPoint;
  }

  private updateBrushCursor(worldPos?: THREE.Vector3): void {
    // Early return - cursor is handled by UI component
    return;
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
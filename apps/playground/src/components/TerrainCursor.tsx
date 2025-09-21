import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { InteractionTool } from './InteractionToolbar';
import { TOOL_COLORS } from './ToolCursor';
import type { Engine } from '@terraforming/engine';

interface TerrainCursorProps {
  activeTool: InteractionTool;
  brushSize: number;
  isVisible: boolean;
  engine: Engine | null;
  mousePosition: { x: number; y: number };
  canvasElement: HTMLCanvasElement | null;
}

export function TerrainCursor({
  activeTool,
  brushSize,
  isVisible,
  engine,
  mousePosition,
  canvasElement
}: TerrainCursorProps) {
  const cursorGroupRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const lastValidPositionRef = useRef<THREE.Vector3 | null>(null);

  // Calculate terrain normal at a given position
  const getTerrainNormal = (engine: Engine, x: number, z: number): THREE.Vector3 => {
    const epsilon = 0.5;

    // Sample heights around the point
    const h0 = engine.getTerrainHeightAt(x, z) || 0;
    const hX1 = engine.getTerrainHeightAt(x + epsilon, z) || 0;
    const hX2 = engine.getTerrainHeightAt(x - epsilon, z) || 0;
    const hZ1 = engine.getTerrainHeightAt(x, z + epsilon) || 0;
    const hZ2 = engine.getTerrainHeightAt(x, z - epsilon) || 0;

    // Calculate gradient (slope)
    const dx = (hX1 - hX2) / (2 * epsilon);
    const dz = (hZ1 - hZ2) / (2 * epsilon);

    // Create normal vector from gradient
    const normal = new THREE.Vector3(-dx, 1, -dz);
    normal.normalize();

    return normal;
  };

  // Initialize cursor group when engine is ready
  useEffect(() => {
    const scene = engine?.getScene();
    if (!scene) return;

    // Create a group to hold cursor elements
    const group = new THREE.Group();

    // Create cursor as a circle of segments that can deform to terrain
    const segments = 64;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * brushSize;
      const z = Math.sin(angle) * brushSize;
      points.push(new THREE.Vector3(x, 0, z));
    }

    // Create line geometry for cursor outline
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: activeTool === 'select' ? 0.7 : 0.9,
      linewidth: 2,
      depthTest: false,
      depthWrite: false,
    });

    const cursorLine = new THREE.Line(geometry, material);
    cursorLine.renderOrder = 1000;
    group.add(cursorLine);

    // Add a center dot for precision
    const dotGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const centerDot = new THREE.Mesh(dotGeometry, dotMaterial);
    centerDot.renderOrder = 1001;
    group.add(centerDot);

    cursorGroupRef.current = group;
    group.visible = false;
    scene.add(group);

    return () => {
      if (cursorGroupRef.current && scene) {
        // Dispose of all geometries and materials
        cursorGroupRef.current.traverse((child) => {
          if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
        scene.remove(cursorGroupRef.current);
        cursorGroupRef.current = null;
      }
    };
  }, [engine, activeTool]);

  // Update cursor position and shape to conform to terrain
  useEffect(() => {
    if (!cursorGroupRef.current || !engine || !canvasElement) return;

    const scene = engine.getScene();
    const camera = engine.getCamera();
    const terrainMesh = engine.getTerrainMesh();

    if (!scene || !camera || !terrainMesh) {
      cursorGroupRef.current.visible = false;
      return;
    }

    // Set visibility based on isVisible prop
    if (!isVisible) {
      cursorGroupRef.current.visible = false;
      return;
    }

    // Convert global mouse position to normalized device coordinates
    const rect = canvasElement.getBoundingClientRect();
    const ndcX = ((mousePosition.x - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((mousePosition.y - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    // First try to intersect with the terrain mesh directly
    const intersects = raycaster.intersectObject(terrainMesh, false);

    let centerPosition: THREE.Vector3 | null = null;

    if (intersects.length > 0) {
      // Get the first intersection point
      const hitPoint = intersects[0].point;

      // Get actual terrain height at this position
      const terrainHeight = engine.getTerrainHeightAt(hitPoint.x, hitPoint.z);

      if (terrainHeight !== null) {
        centerPosition = new THREE.Vector3(hitPoint.x, terrainHeight + 0.2, hitPoint.z);
      }
    }

    // If no direct intersection, use ray marching as fallback
    if (!centerPosition) {
      const rayOrigin = raycaster.ray.origin;
      const rayDirection = raycaster.ray.direction;

      // Use finer step size for more accuracy
      const maxDistance = 300;
      const stepSize = 0.5;

      for (let distance = 0; distance < maxDistance; distance += stepSize) {
        const testPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(distance));

        // Check bounds
        if (Math.abs(testPoint.x) > 50 || Math.abs(testPoint.z) > 50) continue;

        const terrainHeight = engine.getTerrainHeightAt(testPoint.x, testPoint.z);

        if (terrainHeight !== null && testPoint.y <= terrainHeight + 1) {
          centerPosition = new THREE.Vector3(testPoint.x, terrainHeight + 0.2, testPoint.z);
          break;
        }
      }
    }

    // Use last valid position if available to prevent jumping
    if (!centerPosition && lastValidPositionRef.current) {
      centerPosition = lastValidPositionRef.current.clone();
    }

    if (centerPosition) {
      // Store as last valid position
      lastValidPositionRef.current = centerPosition.clone();

      // Update cursor position
      cursorGroupRef.current.position.copy(centerPosition);

      // Update the circle to conform to terrain
      const fillMesh = cursorGroupRef.current.children[0] as THREE.Mesh;
      const line = cursorGroupRef.current.children[1] as THREE.Line;

      // Calculate zoom-based scaling
      const cameraDistance = camera.position.distanceTo(centerPosition);
      const zoomScale = Math.max(0.5, Math.min(2.5, 30 / cameraDistance));

      // Update fill mesh position
      if (fillMesh) {
        fillMesh.position.y = 0.05; // Slight offset above terrain
      }

      if (line && line.geometry) {
        const positions = line.geometry.attributes.position;
        const segments = 64;

        // Update line thickness based on zoom
        const lineMaterial = line.material as THREE.LineBasicMaterial;
        if (lineMaterial) {
          const baseThickness = brushSize < 5 ? 5 : 3;
          lineMaterial.linewidth = Math.max(2, Math.min(8, baseThickness * zoomScale));
        }

        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const localX = Math.cos(angle) * brushSize;
          const localZ = Math.sin(angle) * brushSize;

          // Get world position for this point
          const worldX = centerPosition.x + localX;
          const worldZ = centerPosition.z + localZ;

          // Get terrain height at this point
          const pointHeight = engine.getTerrainHeightAt(worldX, worldZ);

          if (pointHeight !== null) {
            // Set position relative to center with terrain-following height
            positions.setXYZ(
              i,
              localX,
              pointHeight - centerPosition.y + 0.1, // Offset relative to center
              localZ
            );
          } else {
            // Fallback to flat circle
            positions.setXYZ(i, localX, 0, localZ);
          }
        }

        positions.needsUpdate = true;
      }

      // Calculate and apply terrain normal for proper orientation
      const normal = getTerrainNormal(engine, centerPosition.x, centerPosition.z);

      // Create rotation from normal
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);

      // Apply a smooth rotation to prevent jarring changes
      cursorGroupRef.current.quaternion.slerp(quaternion, 0.3);

      cursorGroupRef.current.visible = true;
    } else {
      cursorGroupRef.current.visible = false;
    }
  }, [isVisible, mousePosition, engine, canvasElement, brushSize]);

  // Update cursor appearance when tool or size changes
  useEffect(() => {
    if (!cursorGroupRef.current) return;

    // Update colors for all children
    cursorGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Line) {
        const material = child.material as THREE.LineBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
        material.opacity = activeTool === 'select' ? 0.7 : 0.9;
      } else if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
      }
    });

    // Update cursor size
    const fillMesh = cursorGroupRef.current.children[0] as THREE.Mesh;
    const line = cursorGroupRef.current.children[1] as THREE.Line;

    // Update fill mesh
    if (fillMesh && fillMesh.geometry) {
      fillMesh.geometry.dispose();
      const newFillGeometry = new THREE.CircleGeometry(brushSize, 32);
      newFillGeometry.rotateX(-Math.PI / 2);
      fillMesh.geometry = newFillGeometry;
    }

    // Update outline
    if (line && line.geometry) {
      const segments = 64;
      const points: THREE.Vector3[] = [];

      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = Math.cos(angle) * brushSize;
        const z = Math.sin(angle) * brushSize;
        points.push(new THREE.Vector3(x, 0.05, z));
      }

      line.geometry.setFromPoints(points);
    }
  }, [activeTool, brushSize]);

  // This component doesn't render anything in React - it manages 3D objects directly
  return null;
}
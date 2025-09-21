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
  const cursorMeshRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  // Initialize cursor mesh when engine is ready
  useEffect(() => {
    const scene = engine?.getScene();
    if (!scene) return;

    // Create initial cursor geometry with proper brush size
    let initialGeometry: THREE.BufferGeometry;
    if (activeTool === 'select') {
      initialGeometry = new THREE.RingGeometry(
        Math.max(brushSize - 0.5, 0.5),
        brushSize + 0.5,
        32, 1
      );
    } else {
      initialGeometry = new THREE.RingGeometry(
        Math.max(brushSize - 1, 0.5),
        brushSize + 0.5,
        32, 1
      );
    }

    const material = new THREE.MeshBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: activeTool === 'select' ? 0.6 : 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    cursorMeshRef.current = new THREE.Mesh(initialGeometry, material);
    cursorMeshRef.current.renderOrder = 1000;
    cursorMeshRef.current.visible = false; // Start invisible, will be shown on hover
    cursorMeshRef.current.rotation.set(-Math.PI / 2, 0, 0); // Lay flat on terrain
    scene.add(cursorMeshRef.current);

    return () => {
      if (cursorMeshRef.current && scene) {
        scene.remove(cursorMeshRef.current);
        cursorMeshRef.current.geometry.dispose();
        (cursorMeshRef.current.material as THREE.Material).dispose();
        cursorMeshRef.current = null;
      }
    };
  }, [engine, activeTool, brushSize]); // Depend on tool and size for proper initialization

  // Update cursor position and visibility
  useEffect(() => {
    if (!cursorMeshRef.current || !engine || !canvasElement) return;

    const scene = engine.getScene();
    const camera = engine.getCamera();
    const terrainMesh = engine.getTerrainMesh();

    if (!scene || !camera || !terrainMesh) {
      cursorMeshRef.current.visible = false;
      return;
    }

    // Set visibility based on isVisible prop
    if (!isVisible) {
      cursorMeshRef.current.visible = false;
      return;
    }

    // Convert global mouse position to normalized device coordinates
    const rect = canvasElement.getBoundingClientRect();
    const x = ((mousePosition.x - rect.left) / rect.width) * 2 - 1;
    const y = -((mousePosition.y - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Perform ray-terrain intersection using ray marching
    const rayOrigin = raycaster.ray.origin;
    const rayDirection = raycaster.ray.direction;

    // Ray marching parameters
    const maxDistance = 300;
    const stepSize = 1.0;
    let intersection: THREE.Vector3 | null = null;

    // March along the ray and find intersection with terrain
    for (let distance = 0; distance < maxDistance; distance += stepSize) {
      const currentPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(distance));

      // Check if we're within terrain bounds
      if (currentPoint.x < -50 || currentPoint.x > 50 || currentPoint.z < -50 || currentPoint.z > 50) {
        continue;
      }

      const terrainHeight = engine.getTerrainHeightAt(currentPoint.x, currentPoint.z);

      if (terrainHeight !== null) {
        // Check if ray point is below terrain surface
        if (currentPoint.y <= terrainHeight + 0.5) {
          // Found intersection - refine with smaller steps
          for (let refineDistance = distance - stepSize; refineDistance <= distance; refineDistance += 0.1) {
            const refinePoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(refineDistance));
            const refineTerrainHeight = engine.getTerrainHeightAt(refinePoint.x, refinePoint.z);

            if (refineTerrainHeight !== null && refinePoint.y <= refineTerrainHeight + 0.1) {
              intersection = new THREE.Vector3(refinePoint.x, refineTerrainHeight, refinePoint.z);
              break;
            }
          }
          break;
        }
      }
    }

    if (intersection) {
      cursorMeshRef.current.position.set(intersection.x, intersection.y + 0.1, intersection.z);
      cursorMeshRef.current.visible = true;
    } else {
      // Fallback to base plane intersection
      const intersects = raycaster.intersectObject(terrainMesh);
      if (intersects.length > 0) {
        const basePos = intersects[0].point;
        const terrainHeight = engine.getTerrainHeightAt(basePos.x, basePos.z);
        if (terrainHeight !== null) {
          cursorMeshRef.current.position.set(basePos.x, terrainHeight + 0.1, basePos.z);
          cursorMeshRef.current.visible = true;
        } else {
          cursorMeshRef.current.visible = false;
        }
      } else {
        cursorMeshRef.current.visible = false;
      }
    }
  }, [isVisible, mousePosition, engine, canvasElement]);

  // Update cursor appearance when tool or size changes
  useEffect(() => {
    if (!cursorMeshRef.current) return;

    // Update cursor color and opacity
    const material = cursorMeshRef.current.material as THREE.MeshBasicMaterial;
    material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
    material.opacity = activeTool === 'select' ? 0.6 : 0.8;

    // Update cursor size - create proper geometry based on tool type and brush size
    let newGeometry: THREE.BufferGeometry;
    if (activeTool === 'select') {
      // Thinner ring for select tool
      newGeometry = new THREE.RingGeometry(
        Math.max(brushSize - 0.5, 0.5),
        brushSize + 0.5,
        32, 1
      );
    } else {
      // Thicker ring for brush tools
      newGeometry = new THREE.RingGeometry(
        Math.max(brushSize - 1, 0.5),
        brushSize + 0.5,
        32, 1
      );
    }

    // Replace geometry
    cursorMeshRef.current.geometry.dispose();
    cursorMeshRef.current.geometry = newGeometry;
  }, [activeTool, brushSize]); // Respond to tool and size changes immediately

  // This component doesn't render anything in React - it manages 3D objects directly
  return null;
}
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { InteractionTool } from './InteractionToolbar';
import { TOOL_COLORS } from './ToolCursor';
import type { Engine } from '@terraforming/engine';
import { raycastToTerrain } from '@playground/utils/raycasting';

interface TerrainCursorProps {
  activeTool: InteractionTool;
  brushSize: number;
  isVisible: boolean;
  engine: Engine | null;
  mousePosition: { x: number; y: number };
  canvasElement: HTMLCanvasElement | null;
  isAltPressed: boolean;
}

export function TerrainCursor({
  activeTool,
  brushSize,
  isVisible,
  engine,
  mousePosition,
  canvasElement,
  isAltPressed
}: TerrainCursorProps) {
  const cursorGroupRef = useRef<THREE.Group | null>(null);
  const lastValidPositionRef = useRef<THREE.Vector3 | null>(null);

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

    // Add a center dot for precision (add this first so it's child[0])
    const dotGeometry = new THREE.SphereGeometry(0.3, 8, 8); // Slightly bigger dot
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: activeTool === 'select' ? 0.8 : 0.6, // Muted by default
      depthTest: false,
    });
    const centerDot = new THREE.Mesh(dotGeometry, dotMaterial);
    centerDot.renderOrder = 1001;
    group.add(centerDot);

    // Create line geometry for cursor outline (add this second so it's child[1])
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: activeTool === 'select' ? 0.8 : 0.6, // Muted by default
      linewidth: activeTool === 'select' ? 3 : 4, // Thicker lines for visibility
      depthTest: false,
      depthWrite: false,
    });

    const cursorLine = new THREE.Line(geometry, material);
    cursorLine.renderOrder = 1000;
    group.add(cursorLine);

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

    const camera = engine.getCamera();
    if (!camera) {
      cursorGroupRef.current.visible = false;
      return;
    }

    // Set visibility based on isVisible prop
    if (!isVisible) {
      cursorGroupRef.current.visible = false;
      return;
    }

    // Use shared raycasting utility
    const raycastResult = raycastToTerrain(engine, canvasElement, mousePosition);

    // Use last valid position if no current hit
    let centerPosition: THREE.Vector3 | null = null;
    let normal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

    if (raycastResult) {
      centerPosition = raycastResult.point.clone();
      centerPosition.y += 0.2; // Slight offset above terrain
      normal = raycastResult.normal;
      lastValidPositionRef.current = centerPosition.clone();
    } else if (lastValidPositionRef.current) {
      centerPosition = lastValidPositionRef.current.clone();
    }

    if (centerPosition) {

      // Update cursor position
      cursorGroupRef.current.position.copy(centerPosition);

      // Update the circle to conform to terrain
      const centerDot = cursorGroupRef.current.children[0] as THREE.Mesh; // Center dot is child[0]
      const line = cursorGroupRef.current.children[1] as THREE.Line; // Line is child[1]

      // Calculate zoom-based scaling
      const cameraDistance = camera.position.distanceTo(centerPosition);
      const zoomScale = Math.max(0.5, Math.min(2.5, 30 / cameraDistance));

      // Update center dot position
      if (centerDot) {
        centerDot.position.y = 0.05; // Slight offset above terrain
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

  // Update cursor appearance when tool, size, or Alt key changes
  useEffect(() => {
    if (!cursorGroupRef.current) return;

    // Determine opacity based on Alt key state
    const opacity = isAltPressed ? 1.0 : (activeTool === 'select' ? 0.8 : 0.6); // Saturated when Alt pressed
    const lineWidth = activeTool === 'select' ? 3 : 4; // Thicker for visibility

    // Update colors and opacity for all children
    cursorGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Line) {
        const material = child.material as THREE.LineBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
        material.opacity = opacity;
        material.linewidth = lineWidth;
      } else if (child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
        material.opacity = opacity;
      }
    });

    // Update cursor size
    const centerDot = cursorGroupRef.current.children[0] as THREE.Mesh; // Center dot is child[0]
    const line = cursorGroupRef.current.children[1] as THREE.Line; // Line is child[1]

    // Note: Center dot size doesn't change with brush size - it stays as a fixed reference point

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
  }, [activeTool, brushSize, isAltPressed]);

  // This component doesn't render anything in React - it manages 3D objects directly
  return null;
}
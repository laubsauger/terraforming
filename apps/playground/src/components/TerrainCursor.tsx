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

    // Convert canvas-relative mouse position to normalized device coordinates
    const rect = canvasElement.getBoundingClientRect();
    const x = (mousePosition.x / rect.width) * 2 - 1;
    const y = -(mousePosition.y / rect.height) * 2 + 1;

    // Update raycaster
    const raycaster = raycasterRef.current;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Raycast against terrain base plane to get world coordinates
    const intersects = raycaster.intersectObject(terrainMesh);

    if (intersects.length > 0) {
      const intersection = intersects[0];
      const worldPos = intersection.point;

      // Get accurate height from terrain height texture
      const terrainHeight = engine.getTerrainHeightAt(worldPos.x, worldPos.z);

      if (terrainHeight !== null) {
        // Position cursor at accurate terrain height
        cursorMeshRef.current.position.set(worldPos.x, terrainHeight + 0.1, worldPos.z);
        cursorMeshRef.current.visible = true;
      } else {
        cursorMeshRef.current.visible = false;
      }
    } else {
      cursorMeshRef.current.visible = false;
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
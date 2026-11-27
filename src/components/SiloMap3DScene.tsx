import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Compass, Eye, RotateCcw } from 'lucide-react';
import { SiloDetail } from '../types/nexo.ts';
import { formatKg } from '../lib/api.ts';

interface SiloMap3DSceneProps {
  silos: SiloDetail[];
  selectedSiloId: number | null;
  matchesFilter: (silo: SiloDetail) => boolean;
  onSelectSilo: (silo: SiloDetail) => void;
}

type CameraPresetKey = 'OVERVIEW' | 'LINES' | 'STORAGE' | 'PRODUCTION';

interface CameraPreset {
  id: CameraPresetKey;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'OVERVIEW', label: 'Visão Geral', position: [34, 30, 38], target: [2, 3, 4] },
  { id: 'LINES', label: 'Linhas 1–6', position: [-14, 24, 24], target: [-6, 4, -2] },
  { id: 'STORAGE', label: 'Armazenagem (42–34)', position: [32, 18, 10], target: [16, 4, 0] },
  { id: 'PRODUCTION', label: 'Produção (43–64)', position: [4, 18, 38], target: [2, 2.5, 19] },
];

interface SiloLayoutSpec {
  siloNumber: number;
  x: number;
  z: number;
  radius: number;
  height: number;
  isSplitHalf?: boolean;
}

// Disposição fiel ao croqui oficial (54 silos — sem inventar silos 27 ou 30)
const SILO_LAYOUT_SPECS: SiloLayoutSpec[] = [
  // Linha 6 (4,50 m): 29, 28
  { siloNumber: 29, x: -19.5, z: -9.5, radius: 1.55, height: 4.6 },
  { siloNumber: 28, x: -15.8, z: -9.5, radius: 1.55, height: 4.6 },

  // Linha 5 (7,50 m): 9, 10
  { siloNumber: 9, x: -10.5, z: -9.5, radius: 1.65, height: 6.4 },
  { siloNumber: 10, x: -6.8, z: -9.5, radius: 1.65, height: 6.4 },

  // Linha 4 (11,50 m): Inteiros 11, 12, 13 (esq) | Divididos 14/15, 16/31, 32/33 (dir)
  { siloNumber: 11, x: -1.5, z: -12.5, radius: 1.75, height: 9.2 },
  { siloNumber: 14, x: 2.3, z: -12.5, radius: 1.15, height: 9.2, isSplitHalf: true },
  { siloNumber: 15, x: 4.8, z: -12.5, radius: 1.15, height: 9.2, isSplitHalf: true },

  { siloNumber: 12, x: -1.5, z: -8.0, radius: 1.75, height: 9.2 },
  { siloNumber: 16, x: 2.3, z: -8.0, radius: 1.15, height: 9.2, isSplitHalf: true },
  { siloNumber: 31, x: 4.8, z: -8.0, radius: 1.15, height: 9.2, isSplitHalf: true },

  { siloNumber: 13, x: -1.5, z: -3.5, radius: 1.75, height: 9.2 },
  { siloNumber: 32, x: 2.3, z: -3.5, radius: 1.15, height: 9.2, isSplitHalf: true },
  { siloNumber: 33, x: 4.8, z: -3.5, radius: 1.15, height: 9.2, isSplitHalf: true },

  // Linha 3 (11,50 m): 22, 21, 20, 19, 18, 17 (maior capacidade)
  { siloNumber: 22, x: -18.5, z: 2.0, radius: 1.8, height: 9.2 },
  { siloNumber: 21, x: -14.0, z: 2.0, radius: 1.8, height: 9.2 },
  { siloNumber: 20, x: -18.5, z: 6.5, radius: 1.8, height: 9.2 },
  { siloNumber: 19, x: -14.0, z: 6.5, radius: 1.8, height: 9.2 },
  { siloNumber: 18, x: -18.5, z: 11.0, radius: 1.8, height: 9.2 },
  { siloNumber: 17, x: -14.0, z: 11.0, radius: 1.8, height: 9.2 },

  // Linha 2 (8,50 m): 24, 23
  { siloNumber: 24, x: -7.5, z: 6.5, radius: 1.65, height: 7.2 },
  { siloNumber: 23, x: -3.8, z: 6.5, radius: 1.65, height: 7.2 },

  // Linha 1 (8,50 m): 25, 26
  { siloNumber: 25, x: 1.5, z: 6.5, radius: 1.65, height: 7.2 },
  { siloNumber: 26, x: 5.2, z: 6.5, radius: 1.65, height: 7.2 },

  // Armazenagem Linha 7 (9,00 m): 42 -> 34 (sequência visual vertical à direita)
  ...[42, 41, 40, 39, 38, 37, 36, 35, 34].map((num, idx) => ({
    siloNumber: num,
    x: 15.5 + (idx % 2 === 0 ? -1.8 : 1.8),
    z: -12.0 + Math.floor(idx / 2) * 5.2,
    radius: 1.65,
    height: 7.6,
  })),

  // Produção / Abastecimento: Silos 43 a 64 (2 fileiras de 11)
  ...Array.from({ length: 22 }, (_, i) => {
    const num = 43 + i;
    const row = Math.floor(i / 11);
    const col = i % 11;
    return {
      siloNumber: num,
      x: -18.0 + col * 3.6,
      z: 17.5 + row * 4.2,
      radius: 1.25,
      height: 5.2,
    };
  }),
];

// Reusable math objects outside render callbacks (zero GC in loop)
const _camTargetPos = new THREE.Vector3(34, 30, 38);
const _ctrlTargetPos = new THREE.Vector3(2, 3, 4);
const _pointer = new THREE.Vector2();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, 'rgba(3, 8, 16, 0.72)');
  grad.addColorStop(0.55, 'rgba(3, 8, 16, 0.34)');
  grad.addColorStop(1, 'rgba(3, 8, 16, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createYardFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0D1826';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle industrial concrete grid
  ctx.strokeStyle = 'rgba(174, 184, 197, 0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  // Fine asphalt speckle
  ctx.fillStyle = 'rgba(244, 246, 248, 0.03)';
  for (let i = 0; i < 650; i++) {
    const px = (i * 197) % 1024;
    const py = (i * 353) % 1024;
    ctx.fillRect(px, py, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createSiloLabelTexture(siloNumber: number, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0A1421';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#F5B91B';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, 246, 118);

  ctx.fillStyle = '#AEB8C5';
  ctx.font = 'bold 24px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SILO', 128, 38);

  ctx.fillStyle = '#F4F6F8';
  ctx.font = '900 62px Inter, sans-serif';
  ctx.fillText(String(siloNumber), 128, 102);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function getSiloVisualColors(s: SiloDetail | undefined): {
  statusColor: number;
  emissive: number;
  emissiveIntensity: number;
  shellTint: number;
} {
  if (!s) {
    return {
      statusColor: 0x3b82f6,
      emissive: 0x000000,
      emissiveIntensity: 0,
      shellTint: 0x22364d,
    };
  }

  if (s.operationalStatus === 'BLOQUEADO' || s.operationalStatus === 'MANUTENCAO') {
    return {
      statusColor: 0xef4444,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.45,
      shellTint: 0x3a2026,
    };
  }

  if (s.stockAlertLevel === 'CRITICO') {
    return {
      statusColor: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.55,
      shellTint: 0x382028,
    };
  }

  if (s.stockAlertLevel === 'ATENCAO') {
    return {
      statusColor: 0xf97316,
      emissive: 0x9a3412,
      emissiveIntensity: 0.45,
      shellTint: 0x382a20,
    };
  }

  if (s.isReceiving) {
    return {
      statusColor: 0x22d3ee,
      emissive: 0x0e7490,
      emissiveIntensity: 0.45,
      shellTint: 0x1b3b4a,
    };
  }

  if (s.category === 'ARMAZENAGEM') {
    return {
      statusColor: 0x10b981,
      emissive: 0x064e3b,
      emissiveIntensity: 0.25,
      shellTint: 0x1d3b38,
    };
  }

  if (s.category === 'PRODUCAO') {
    return {
      statusColor: 0xf59e0b,
      emissive: 0x78350f,
      emissiveIntensity: 0.25,
      shellTint: 0x2f2b27,
    };
  }

  return {
    statusColor: 0x3b82f6,
    emissive: 0x1e3a8a,
    emissiveIntensity: 0.25,
    shellTint: 0x23384f,
  };
}

interface SiloRigEntry {
  spec: SiloLayoutSpec;
  group: THREE.Group;
  shellMat: THREE.MeshPhysicalMaterial;
  ringMat: THREE.MeshStandardMaterial;
  levelBarMesh: THREE.Mesh;
  levelBarMat: THREE.MeshStandardMaterial;
  roofMat: THREE.MeshStandardMaterial;
  selectionRingMesh: THREE.Mesh;
}

export const SiloMap3DScene: React.FC<SiloMap3DSceneProps> = ({
  silos,
  selectedSiloId,
  matchesFilter,
  onSelectSilo,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const silosRef = useRef<SiloDetail[]>(silos);
  const matchesFilterRef = useRef(matchesFilter);
  const selectedSiloIdRef = useRef(selectedSiloId);
  const onSelectSiloRef = useRef(onSelectSilo);

  silosRef.current = silos;
  matchesFilterRef.current = matchesFilter;
  selectedSiloIdRef.current = selectedSiloId;
  onSelectSiloRef.current = onSelectSilo;

  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [activePreset, setActivePreset] = useState<CameraPresetKey>('OVERVIEW');
  const [hoveredSilo, setHoveredSilo] = useState<{
    silo: SiloDetail;
    x: number;
    y: number;
  } | null>(null);

  const cameraPresetFnRef = useRef<((preset: CameraPreset) => void) | null>(null);
  const syncSilosFnRef = useRef<(() => void) | null>(null);

  const summary = useMemo(() => {
    let critical = 0;
    let attention = 0;
    let receiving = 0;
    for (const s of silos) {
      if (s.stockAlertLevel === 'CRITICO') critical++;
      else if (s.stockAlertLevel === 'ATENCAO') attention++;
      if (s.isReceiving) receiving++;
    }
    return { total: silos.length, critical, attention, receiving };
  }, [silos]);

  // Trigger visual refresh whenever silo data, filter, or selection changes
  useEffect(() => {
    syncSilosFnRef.current?.();
  }, [silos, selectedSiloId, matchesFilter]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || 960;
    const height = container.clientHeight || 580;
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#081321');
    scene.fog = new THREE.Fog('#081321', 56, 132);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.25, 220);
    camera.position.set(34, 30, 38);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(2, 3, 4);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.465;
    controls.minDistance = 10;
    controls.maxDistance = 90;
    controls.update();

    // 3-point studio lighting + cool sky/ground HemisphereLight
    const hemiLight = new THREE.HemisphereLight(0x9ec5ff, 0x0b1523, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    keyLight.position.set(28, 42, 22);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.left = -35;
      keyLight.shadow.camera.right = 35;
      keyLight.shadow.camera.top = 35;
      keyLight.shadow.camera.bottom = -35;
      keyLight.shadow.camera.near = 5;
      keyLight.shadow.camera.far = 110;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.9);
    rimLight.position.set(-32, 22, -26);
    scene.add(rimLight);

    // Track disposable resources
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];

    const floorTexture = createYardFloorTexture(maxAnisotropy);
    const contactShadowTex = createContactShadowTexture();
    textures.push(floorTexture, contactShadowTex);

    // Ground slab (extended outdoor perimeter fading smoothly into fog)
    const groundGeo = new THREE.PlaneGeometry(240, 240);
    const groundMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.88,
      metalness: 0.08,
    });
    geometries.push(groundGeo);
    materials.push(groundMat);

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = 0;
    groundMesh.receiveShadow = !isSoftwareGl;
    scene.add(groundMesh);

    // Operational Zone Aprons (offset +0.02 on Y to prevent coplanar Z-fighting)
    const addZonePad = (
      cx: number,
      cz: number,
      w: number,
      d: number,
      borderHex: number,
      fillHex: number
    ) => {
      const padGeo = new THREE.PlaneGeometry(w, d);
      const padMat = new THREE.MeshStandardMaterial({
        color: fillHex,
        roughness: 0.82,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.06, d));
      const borderMat = new THREE.LineBasicMaterial({ color: borderHex });
      geometries.push(padGeo, borderGeo);
      materials.push(padMat, borderMat);

      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(cx, 0.025, cz);
      pad.receiveShadow = !isSoftwareGl;
      scene.add(pad);

      const border = new THREE.LineSegments(borderGeo, borderMat);
      border.position.set(cx, 0.03, cz);
      scene.add(border);
    };

    // Linhas 1-6 Moega bay
    addZonePad(-6.8, -0.5, 31.5, 30.5, 0x3b82f6, 0x0f1f33);
    // Armazenagem L7 (42 -> 34) bay
    addZonePad(15.5, -1.5, 9.5, 30.0, 0x10b981, 0x0d2224);
    // Produção / Abastecimento (43 -> 64) bay
    addZonePad(0.0, 19.6, 42.0, 9.8, 0xf59e0b, 0x1d1c21);

    // Industrial conveyor overhead pipe bridge connecting Armazenagem L7 to Linhas 1-6
    const pipePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(15.5, 9.8, -11.5),
      new THREE.Vector3(15.5, 9.8, 6.2),
      new THREE.Vector3(4.5, 11.2, 6.2),
      new THREE.Vector3(-1.5, 11.2, -8.0),
      new THREE.Vector3(-16.0, 11.2, 4.5),
    ]);
    const pipeGeo = new THREE.TubeGeometry(pipePath, 42, 0.22, 8, false);
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.28,
    });
    geometries.push(pipeGeo);
    materials.push(pipeMat);
    const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
    scene.add(pipeMesh);

    // Shared materials & reusable unit geometries for composite 6-part silos
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.88,
      metalness: 0.06,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.28,
      metalness: 0.85,
    });
    const shadowPlaneMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const labelPlaneGeo = new THREE.PlaneGeometry(1.5, 0.75);
    const shadowPlaneGeo = new THREE.PlaneGeometry(1, 1);

    geometries.push(labelPlaneGeo, shadowPlaneGeo);
    materials.push(concreteMat, darkSteelMat, shadowPlaneMat);

    const siloRigs = new Map<number, SiloRigEntry>();
    const raycastTargets: THREE.Object3D[] = [];

    for (const spec of SILO_LAYOUT_SPECS) {
      const group = new THREE.Group();
      group.position.set(spec.x, 0, spec.z);

      const r = spec.radius;
      const bodyH = spec.height * 0.68;
      const hopperH = spec.height * 0.14;
      const plinthH = 0.28;
      const roofH = spec.height * 0.14;
      const baseBodyY = plinthH + hopperH;

      // 0. Soft contact shadow plane grounded at y = 0.04
      const contactShadow = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
      contactShadow.rotation.x = -Math.PI / 2;
      contactShadow.scale.set(r * 3.1, r * 3.1, 1);
      contactShadow.position.y = 0.04;
      group.add(contactShadow);

      // 1. Concrete Foundation Plinth (octagonal)
      const plinthGeo = new THREE.CylinderGeometry(r * 1.12, r * 1.2, plinthH, 8);
      geometries.push(plinthGeo);
      const plinthMesh = new THREE.Mesh(plinthGeo, concreteMat);
      plinthMesh.position.y = plinthH / 2;
      plinthMesh.receiveShadow = !isSoftwareGl;
      plinthMesh.castShadow = !isSoftwareGl;
      group.add(plinthMesh);

      // 2. Discharge Hopper Cone + Support Skirt
      const hopperGeo = new THREE.CylinderGeometry(r * 0.96, r * 0.28, hopperH, 16);
      geometries.push(hopperGeo);
      const hopperMesh = new THREE.Mesh(hopperGeo, darkSteelMat);
      hopperMesh.position.y = plinthH + hopperH / 2;
      hopperMesh.castShadow = !isSoftwareGl;
      group.add(hopperMesh);

      // 3. Main Cylindrical Silo Body (PBR painted industrial steel)
      const shellGeo = new THREE.CylinderGeometry(r, r, bodyH, 24);
      const shellMat = new THREE.MeshPhysicalMaterial({
        color: 0x23384f,
        metalness: 0.48,
        roughness: 0.36,
        clearcoat: 0.25,
        clearcoatRoughness: 0.3,
      });
      geometries.push(shellGeo);
      materials.push(shellMat);

      const shellMesh = new THREE.Mesh(shellGeo, shellMat);
      shellMesh.position.y = baseBodyY + bodyH / 2;
      shellMesh.castShadow = !isSoftwareGl;
      shellMesh.receiveShadow = !isSoftwareGl;
      shellMesh.layers.enable(1);
      shellMesh.userData.siloNumber = spec.siloNumber;
      raycastTargets.push(shellMesh);
      group.add(shellMesh);

      // 4. Structural Reinforcement Collar Rings (lower & upper steel seam bands)
      const seamGeo = new THREE.TorusGeometry(r * 1.015, 0.055, 8, 24);
      geometries.push(seamGeo);
      const lowerSeam = new THREE.Mesh(seamGeo, darkSteelMat);
      lowerSeam.rotation.x = Math.PI / 2;
      lowerSeam.position.y = baseBodyY + bodyH * 0.33;
      group.add(lowerSeam);

      const upperSeam = new THREE.Mesh(seamGeo, darkSteelMat);
      upperSeam.rotation.x = Math.PI / 2;
      upperSeam.position.y = baseBodyY + bodyH * 0.68;
      group.add(upperSeam);

      // 5. Status Crown Collar Ring (color-coded Operational / Category / Alert indicator)
      const ringGeo = new THREE.CylinderGeometry(r * 1.045, r * 1.045, 0.26, 24);
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x1e3a8a,
        emissiveIntensity: 0.25,
        metalness: 0.25,
        roughness: 0.35,
      });
      geometries.push(ringGeo);
      materials.push(ringMat);

      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = baseBodyY + bodyH - 0.14;
      group.add(ringMesh);

      // 6. Vertical Stock Occupancy Level Gauge Bar on front face
      const levelBgGeo = new THREE.BoxGeometry(0.24, bodyH * 0.72, 0.12);
      geometries.push(levelBgGeo);
      const levelBg = new THREE.Mesh(levelBgGeo, darkSteelMat);
      levelBg.position.set(0, baseBodyY + bodyH * 0.45, r + 0.04);
      group.add(levelBg);

      const levelFillH = Math.max(0.15, bodyH * 0.68);
      const levelFillGeo = new THREE.BoxGeometry(0.16, levelFillH, 0.14);
      levelFillGeo.translate(0, levelFillH / 2, 0); // bottom-anchored scale
      const levelBarMat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x064e3b,
        emissiveIntensity: 0.35,
        roughness: 0.3,
        metalness: 0.2,
      });
      geometries.push(levelFillGeo);
      materials.push(levelBarMat);
      const levelBarMesh = new THREE.Mesh(levelFillGeo, levelBarMat);
      levelBarMesh.position.set(0, baseBodyY + bodyH * 0.1, r + 0.06);
      group.add(levelBarMesh);

      // 7. Ribbed Conical Roof + Inspection Hatch + Guardrail
      const roofGeo = new THREE.ConeGeometry(r * 1.06, roofH, 24);
      const roofMat = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        metalness: 0.78,
        roughness: 0.28,
      });
      geometries.push(roofGeo);
      materials.push(roofMat);

      const roofMesh = new THREE.Mesh(roofGeo, roofMat);
      roofMesh.position.y = baseBodyY + bodyH + roofH / 2;
      roofMesh.castShadow = !isSoftwareGl;
      roofMesh.layers.enable(1);
      roofMesh.userData.siloNumber = spec.siloNumber;
      raycastTargets.push(roofMesh);
      group.add(roofMesh);

      const hatchGeo = new THREE.CylinderGeometry(r * 0.22, r * 0.24, 0.22, 12);
      geometries.push(hatchGeo);
      const hatchMesh = new THREE.Mesh(hatchGeo, darkSteelMat);
      hatchMesh.position.y = baseBodyY + bodyH + roofH + 0.08;
      group.add(hatchMesh);

      // 8. Procedural Number Plate facing forward (+Z)
      const labelTex = createSiloLabelTexture(spec.siloNumber, maxAnisotropy);
      textures.push(labelTex);
      const labelMat = new THREE.MeshBasicMaterial({
        map: labelTex,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      materials.push(labelMat);
      const labelMesh = new THREE.Mesh(labelPlaneGeo, labelMat);
      labelMesh.scale.set(spec.isSplitHalf ? 0.62 : 0.88, spec.isSplitHalf ? 0.62 : 0.88, 1);
      labelMesh.position.set(0, baseBodyY + bodyH * 0.82, r + 0.1);
      group.add(labelMesh);

      // 9. Selection Halo Ring on floor
      const selGeo = new THREE.RingGeometry(r * 1.25, r * 1.48, 32);
      const selMat = new THREE.MeshBasicMaterial({
        color: 0xf5b91b,
        side: THREE.DoubleSide,
      });
      geometries.push(selGeo);
      materials.push(selMat);
      const selectionRingMesh = new THREE.Mesh(selGeo, selMat);
      selectionRingMesh.rotation.x = -Math.PI / 2;
      selectionRingMesh.position.y = 0.06;
      selectionRingMesh.visible = false;
      group.add(selectionRingMesh);

      scene.add(group);
      siloRigs.set(spec.siloNumber, {
        spec,
        group,
        shellMat,
        ringMat,
        levelBarMesh,
        levelBarMat,
        roofMat,
        selectionRingMesh,
      });
    }

    // Coalesced on-demand renderer + smooth camera preset transitions
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let cameraAnimating = false;
    let lastTransitionTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (!sync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTransitionTime) / 1000));
        lastTransitionTime = now;

        if (cameraAnimating) {
          const factor = 6.5;
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, factor, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, factor, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, factor, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _ctrlTargetPos.x, factor, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _ctrlTargetPos.y, factor, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _ctrlTargetPos.z, factor, dt);

          const distCam = camera.position.distanceTo(_camTargetPos);
          const distTarget = controls.target.distanceTo(_ctrlTargetPos);
          if (distCam < 0.08 && distTarget < 0.08) {
            camera.position.copy(_camTargetPos);
            controls.target.copy(_ctrlTargetPos);
            cameraAnimating = false;
          } else {
            renderDirty = true;
          }
        }

        const needsDamping = controls.update();
        if (needsDamping && !isSoftwareGl) {
          renderDirty = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    const syncSilosVisualState = () => {
      const byNum = new Map<number, SiloDetail>();
      for (const s of silosRef.current) byNum.set(s.siloNumber, s);

      for (const [siloNum, rig] of siloRigs.entries()) {
        const s = byNum.get(siloNum);
        const colors = getSiloVisualColors(s);
        const isMatched = s ? matchesFilterRef.current(s) : true;
        const isSelected = s ? s.id === selectedSiloIdRef.current : false;

        rig.shellMat.color.setHex(colors.shellTint);
        rig.shellMat.opacity = isMatched ? 1.0 : 0.25;
        rig.shellMat.transparent = !isMatched;

        rig.ringMat.color.setHex(colors.statusColor);
        rig.ringMat.emissive.setHex(colors.emissive);
        rig.ringMat.emissiveIntensity = isMatched ? colors.emissiveIntensity : 0.05;

        const pct = s ? Math.max(0.04, Math.min(1, s.occupancyPercent / 100)) : 0.04;
        rig.levelBarMesh.scale.y = pct;
        rig.levelBarMat.color.setHex(colors.statusColor);
        rig.levelBarMat.emissive.setHex(colors.emissive);

        rig.roofMat.opacity = isMatched ? 1.0 : 0.3;
        rig.roofMat.transparent = !isMatched;

        rig.selectionRingMesh.visible = isSelected;
      }

      requestRender();
    };

    syncSilosFnRef.current = syncSilosVisualState;
    syncSilosVisualState();

    cameraPresetFnRef.current = (preset: CameraPreset) => {
      _camTargetPos.set(preset.position[0], preset.position[1], preset.position[2]);
      _ctrlTargetPos.set(preset.target[0], preset.target[1], preset.target[2]);
      cameraAnimating = true;
      lastTransitionTime = performance.now();
      requestRender();
    };

    // Cancel camera preset animation if user manually interacts with OrbitControls
    const handleControlsStart = () => {
      cameraAnimating = false;
    };
    const handleControlsChange = () => {
      requestRender();
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    // Pre-warm shaders on hardware GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Raycasting on dedicated layer 1 with pointermove throttling
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);

    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverCheck = 0;

    const findSiloFromEvent = (ev: PointerEvent): SiloDetail | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointer, camera);
      const hits = raycaster.intersectObjects(raycastTargets, false);
      if (hits.length === 0) return null;
      const siloNumber = Number(hits[0].object.userData?.siloNumber);
      return silosRef.current.find((s) => s.siloNumber === siloNumber) ?? null;
    };

    const onPointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };

    const onPointerUp = (ev: PointerEvent) => {
      const dx = ev.clientX - pointerDownPos.x;
      const dy = ev.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;
      const hitSilo = findSiloFromEvent(ev);
      if (hitSilo) {
        onSelectSiloRef.current(hitSilo);
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverCheck < 50) return;
      lastHoverCheck = now;

      const hitSilo = findSiloFromEvent(ev);
      if (!hitSilo) {
        renderer.domElement.style.cursor = 'grab';
        setHoveredSilo((prev) => (prev ? null : prev));
        return;
      }
      renderer.domElement.style.cursor = 'pointer';
      const rect = container.getBoundingClientRect();
      setHoveredSilo({
        silo: hitSilo,
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
      });
    };

    const onPointerLeave = () => {
      setHoveredSilo(null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(300, Math.floor(entry.contentRect.width));
        const h = Math.max(300, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    requestRender();

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      envTarget.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Keyboard shortcut 'H' to toggle bottom control dock
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        setDockCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectPreset = (preset: CameraPreset) => {
    setActivePreset(preset.id);
    cameraPresetFnRef.current?.(preset);
  };

  return (
    <div className="relative h-[620px] w-full overflow-hidden rounded-xl border border-[#AEB8C5]/20 bg-[#081321]">
      {/* Dedicated WebGL Mount Container (Zero React children) */}
      <div ref={mountRef} className="h-full w-full" />

      {/* Minimal Top-Left Plant Spec Badge (Zero backdrop-filter, static indicators only) */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421]/92 px-3 py-2 text-xs">
        <Compass className="h-4 w-4 text-[#F5B91B]" />
        <span className="font-display font-bold text-[#F4F6F8]">Planta 3D da Moega</span>
        <span className="text-[#AEB8C5]">· {summary.total} silos oficiais</span>
        {summary.critical > 0 && (
          <span className="rounded border border-red-500/50 bg-red-950/90 px-2 py-0.5 font-mono-tabular font-bold text-red-300">
            {summary.critical} Crítico
          </span>
        )}
        {summary.attention > 0 && (
          <span className="rounded border border-orange-500/50 bg-orange-950/90 px-2 py-0.5 font-mono-tabular font-bold text-orange-300">
            {summary.attention} Baixo
          </span>
        )}
        {summary.receiving > 0 && (
          <span className="rounded border border-cyan-400/50 bg-cyan-950/90 px-2 py-0.5 font-mono-tabular font-bold text-cyan-200">
            {summary.receiving} Recebendo
          </span>
        )}
      </div>

      {/* Hover Tooltip */}
      {hoveredSilo && (
        <div
          style={{
            left: Math.min(hoveredSilo.x + 14, 520),
            top: Math.max(hoveredSilo.y - 12, 16),
          }}
          className="pointer-events-none absolute z-20 max-w-[260px] rounded-lg border border-[#F5B91B]/60 bg-[#0A1421]/95 px-3 py-2 text-xs shadow-lg"
        >
          <p className="font-display font-extrabold text-[#F5B91B]">
            Silo {hoveredSilo.silo.siloNumber} · {hoveredSilo.silo.lineName}
          </p>
          <p className="mt-0.5 truncate font-semibold text-[#F4F6F8]">
            {hoveredSilo.silo.materialDescription || 'Sem MP vinculada'}
          </p>
          <p className="mt-1 font-mono-tabular text-[11px] text-[#AEB8C5]">
            Saldo: {formatKg(hoveredSilo.silo.confirmedStockKg)} ({hoveredSilo.silo.occupancyPercent.toFixed(0)}%)
          </p>
          <p className="mt-0.5 text-[10px] text-[#AEB8C5]">Clique para abrir ficha completa</p>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Solid/RGBA dark surface, NO backdrop-filter) */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex w-[min(900px,94%)] -translate-x-1/2 flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-1.5 inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 border-[#AEB8C5]/25 bg-[#101B2A]/95 px-3 py-1 text-[11px] font-semibold text-[#AEB8C5] hover:text-[#F5B91B]"
          title="Alternar controles (tecla H)"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Mostrar Controles 3D</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Ocultar Controles (H)</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-[#AEB8C5]/25 bg-[#101B2A]/95 px-3.5 py-2.5 shadow-xl">
            <div className="flex flex-wrap items-center gap-1.5">
              <Eye className="mr-1 h-4 w-4 text-[#F5B91B]" />
              {CAMERA_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold transition-colors ${
                    activePreset === preset.id
                      ? 'bg-[#F5B91B] text-[#0A1421]'
                      : 'border border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5] hover:text-[#F4F6F8]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-[#AEB8C5]">
              <span className="hidden sm:inline">Arraste para girar · Role para zoom · Clique no silo</span>
              <button
                type="button"
                onClick={() => selectPreset(CAMERA_PRESETS[0])}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-2.5 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
              >
                <RotateCcw className="h-3.5 w-3.5 text-[#F5B91B]" />
                <span>Resetar</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

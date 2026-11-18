import { t } from '../i18n';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ViewZoomControls } from './ViewZoomControls';
import { wheelZoom } from '../utils/viewZoom';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { findSketchReferenceHit } from '../utils/sketchReferencePicking';
import {
  CadShape,
  CameraViewId,
  CAMERA_VIEWS,
  MATERIAL_PRESETS,
  createExtrudedGeometry,
  computeShapeMetrics,
  computeSceneMetrics,
  computeBounds2D,
} from '../utils/cadEngine';
import {
  Box,
  Compass,
  Eye,
  Grid,
  Layers,
  Maximize2,
  Camera,
} from 'lucide-react';

export interface RenderedViewCapture {
  id: CameraViewId;
  label: string;
  axisDesc: string;
  dataUrl: string;
}

export interface Cad3DExporterApi {
  captureSingleView: (viewId: CameraViewId, width?: number, height?: number) => string;
  captureAllStandardViews: () => RenderedViewCapture[];
  generateEngineeringSheetPng: () => string;
}

interface Cad3DViewportProps {
  shapes: CadShape[];
  selectedIds: string[];
  onSelectShape: (id: string | null, additive?: boolean, remove?: boolean) => void;
  activeView: CameraViewId;
  onChangeView: (viewId: CameraViewId) => void;
  explodedFactor: number;
  wireframeOverlay: boolean;
  onToggleWireframe: () => void;
  onRegisterExporter: (api: Cad3DExporterApi) => void;
  /** 与 2D 画布吸附联动的网格细分间距 (mm) */
  gridStep?: number;
  fitRequest?: number;
}

const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return true;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

// Pre-allocated math helpers at module scope (zero GC in render ticks)
const _targetVec = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

const isVisibleShape = (shape: CadShape) => shape.visible && (shape.type === 'point'
  ? shape.points.length === 1 : shape.type === 'segment' ? shape.points.length === 2 : shape.points.length >= 3);
const isReferenceShape = (shape: CadShape) => shape.type === 'point' || shape.type === 'segment';

function disposeShapeGroup(group: THREE.Object3D) {
  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh || (object as THREE.Line).isLine || (object as THREE.Points).isPoints) {
      const renderable = object as THREE.Mesh;
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material)) renderable.material.forEach((material) => material.dispose());
      else renderable.material?.dispose();
    }
  });
}

function createPointMarkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.strokeStyle = '#ffffff'; context.lineWidth = 5;
  // A small cross denotes a point; selected points remain distinct by size and color.
  context.beginPath(); context.moveTo(5, 32); context.lineTo(59, 32);
  context.moveTo(32, 5); context.lineTo(32, 59); context.stroke();
  return new THREE.CanvasTexture(canvas);
}

function getSceneTarget(shapes: CadShape[]) {
  const visible = shapes.filter(isVisibleShape);
  if (!visible.length) return { x: 0, y: 0, z: 10 };
  const bounds = computeBounds2D(visible.flatMap((shape) => shape.points));
  const minZ = Math.min(...visible.map((shape) => shape.zOffset));
  const maxZ = Math.max(...visible.map((shape) => shape.zOffset + shape.zHeight));
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: (minZ + maxZ) / 2 };
}

export const Cad3DViewport: React.FC<Cad3DViewportProps> = ({
  shapes,
  selectedIds,
  onSelectShape,
  activeView,
  onChangeView,
  explodedFactor,
  wireframeOverlay,
  onToggleWireframe,
  onRegisterExporter,
  gridStep = 2,
  fitRequest = 0,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Refs for mutable state used inside WebGL callbacks
  const shapesRef = useRef<CadShape[]>(shapes);
  shapesRef.current = shapes;
  const selectedIdsRef = useRef<Set<string>>(new Set(selectedIds));
  selectedIdsRef.current = new Set(selectedIds);
  const onSelectShapeRef = useRef(onSelectShape);
  onSelectShapeRef.current = onSelectShape;
  const explodedRef = useRef(explodedFactor);
  explodedRef.current = explodedFactor;
  const wireframeRef = useRef(wireframeOverlay);
  wireframeRef.current = wireframeOverlay;

  // Store Three.js objects in refs so scene never tears down on React state updates
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshesGroupRef = useRef<THREE.Group | null>(null);
  const buildPlateGroupRef = useRef<THREE.Group | null>(null);
  const interactablesRef = useRef<THREE.Object3D[]>([]);
  const pointMarkerTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const requestRenderRef = useRef<() => void>(() => {});
  const changeZoomPercent = (percent: number) => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.zoom = Math.min(1000, Math.max(0.0001, percent / 100));
    camera.updateProjectionMatrix();
    setZoomPercent(camera.zoom * 100);
    requestRenderRef.current();
  };

  // Build a multi-part THREE.Group for a CadShape (Z-up CAD coordinate space)
  const buildCadShapeGroup = useCallback(
    (
      shape: CadShape,
      index: number,
      isSelected: boolean,
      explodeVal: number,
      showEdges: boolean,
    ): THREE.Group => {
      const group = new THREE.Group();
      group.name = `cad-group-${shape.id}`;
      group.userData = { shapeId: shape.id };

      if (isReferenceShape(shape)) {
        const geometry = new THREE.BufferGeometry().setFromPoints(shape.points.map((point) => new THREE.Vector3(point.x, point.y, 0)));
        const color = isSelected ? '#67B1FF' : shape.color;
        let reference: THREE.Points | THREE.Line;
        if (shape.type === 'point') {
          pointMarkerTextureRef.current ??= createPointMarkerTexture();
          reference = new THREE.Points(geometry, new THREE.PointsMaterial({
            color, size: isSelected ? 9 : 7, sizeAttenuation: false, map: pointMarkerTextureRef.current,
            transparent: true, opacity: !isSelected && shapesRef.current.some((s) => s.visible && s.endpointIds?.includes(shape.id)) ? 0 : 1, alphaTest: .1, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
          }));
        } else {
          reference = new THREE.Line(geometry, new THREE.LineBasicMaterial({
            color, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
          }));
        }
        reference.userData = { shapeId: shape.id, sketchReference: true };
        reference.renderOrder = shape.type === 'point' ? 12 : 11;
        group.position.z = shape.zOffset;
        group.add(reference);
        // Reference marks have a screen-pixel hit tolerance in either projection.
        // Keep the normal Raycaster selection pipeline without giving a point a physical radius.
        reference.raycast = (raycaster, hits) => {
          const camera = raycaster.camera;
          const element = rendererRef.current?.domElement;
          if (!camera || !element) return;
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          reference.updateWorldMatrix(true, false);
          const world = shape.points.map((point) => reference.localToWorld(new THREE.Vector3(point.x, point.y, 0)));
          const point = findSketchReferenceHit(world, camera, _mouse, rect, shape.type === 'point' ? 11 : 7);
          if (!point) return;
          hits.push({ distance: raycaster.ray.origin.distanceTo(point), point, object: reference });
        };
        return group;
      }

      // Share the same hole-aware solid geometry with STL / OBJ export.
      const sourceGeometry = createExtrudedGeometry(shape, isSoftwareGl ? 2 : 3);
      // Smooth cylindrical walls in the preview while preserving sharp mechanical edges.
      // Export geometry is generated independently and retains its exact topology.
      const extrudeGeo = toCreasedNormals(sourceGeometry, Math.PI / 6);
      if (extrudeGeo !== sourceGeometry) sourceGeometry.dispose();

      const preset =
        MATERIAL_PRESETS[shape.materialPreset] ?? MATERIAL_PRESETS.aluminum;
      const isTransmissive = preset.transmission > 0.5;

      // Primary solid mesh
      const mainMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(shape.color),
        roughness: shape.materialPreset === 'aluminum' ? 0.48 : preset.roughness,
        metalness: shape.materialPreset === 'aluminum' ? 0.18 : preset.metalness,
        transmission: isSoftwareGl ? 0 : preset.transmission,
        transparent: isTransmissive,
        opacity: isTransmissive ? (isSoftwareGl ? 0.55 : 0.88) : 1.0,
        clearcoat: 0,
        emissive: new THREE.Color(isSelected ? 0x163451 : 0x000000),
        emissiveIntensity: isSelected ? 0.2 : 0,
      });

      const solidMesh = new THREE.Mesh(extrudeGeo, mainMat);
      solidMesh.castShadow = !isSoftwareGl;
      solidMesh.receiveShadow = !isSoftwareGl;
      solidMesh.userData = { shapeId: shape.id };
      group.add(solidMesh);

      // Secondary part: Precision CAD hard-edge wireframe highlight
      if (showEdges || isSelected) {
        const edgesGeo = new THREE.EdgesGeometry(extrudeGeo, 18);
        const edgesMat = new THREE.LineBasicMaterial({
          color: isSelected ? 0x4c9aff : 0x778393,
          transparent: true,
          opacity: isSelected ? 0.95 : 0.62,
        });
        const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
        group.add(edgesLine);
      }

      // Position along Z axis (including exploded view separation)
      const explodeZ = explodeVal * index * 18;
      group.position.set(0, 0, shape.zOffset + explodeZ);

      return group;
    },
    [],
  );

  // Rebuild meshes inside scene when shapes / selection / explode change
  const syncSceneMeshes = useCallback(() => {
    const meshesGroup = meshesGroupRef.current;
    if (!meshesGroup) return;

    // Dispose previous geometries & materials cleanly
    disposeShapeGroup(meshesGroup);
    meshesGroup.clear();
    interactablesRef.current = [];

    const visibleShapes = shapesRef.current.filter(isVisibleShape);

    visibleShapes.forEach((shape, idx) => {
      const isSelected = selectedIdsRef.current.has(shape.id);
      const shapeGroup = buildCadShapeGroup(
        shape,
        idx,
        isSelected,
        explodedRef.current,
        wireframeRef.current,
      );
      meshesGroup.add(shapeGroup);
      // First child is the solid mesh or a reference point/line.
      if (shapeGroup.children[0]) {
        interactablesRef.current.push(shapeGroup.children[0]);
      }
    });

    requestRenderRef.current();
  }, [buildCadShapeGroup]);

  // Fit the visible model into a common safe area, using its bounds and true projection.
  const applyCameraPreset = useCallback((viewId: CameraViewId) => {
    const renderer = rendererRef.current;
    const container = canvasMountRef.current;
    if (!renderer || !container) return;
    const width = Math.max(16, container.clientWidth);
    const height = Math.max(16, container.clientHeight);
    const aspect = width / height;
    const spec = CAMERA_VIEWS.find(v => v.id === viewId) ?? CAMERA_VIEWS[0];
    const bounds = new THREE.Box3();
    shapesRef.current.filter(isVisibleShape).forEach((shape, index) => {
      const z = shape.zOffset + (isReferenceShape(shape) ? 0 : explodedRef.current * index * 18);
      shape.points.forEach(point => {
        bounds.expandByPoint(new THREE.Vector3(point.x, point.y, z));
        bounds.expandByPoint(new THREE.Vector3(point.x, point.y, z + shape.zHeight));
      });
    });
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-40, -30, 0), new THREE.Vector3(40, 30, 30));
    bounds.expandByScalar(1);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const target = sphere.center;
    const radius = Math.max(5, sphere.radius);
    const direction = new THREE.Vector3(...(viewId === 'isometric' ? [1, -1, 1] as const : spec.positionDir)).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(...spec.up), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      corners.push(new THREE.Vector3(x, y, z).sub(target));
    }
    const fill = 0.64;
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    let distance: number;
    if (spec.orthographic) {
      const halfHeight = Math.max(10, ...corners.map(p => Math.max(Math.abs(p.dot(up)) / fill, Math.abs(p.dot(right)) / (aspect * fill))));
      distance = radius * 4;
      camera = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.1, Math.max(1000, radius * 35));
      camera.userData.baseHalfHeight = halfHeight;
      camera.userData.baseAspect = aspect;
    } else {
      const fov = 36;
      const tanVertical = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const tanHorizontal = tanVertical * aspect;
      distance = Math.max(radius * 1.4, ...corners.map(p => p.dot(direction) + Math.max(Math.abs(p.dot(up)) / (tanVertical * fill), Math.abs(p.dot(right)) / (tanHorizontal * fill))));
      camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, Math.max(1000, radius * 35));
    }
    camera.up.set(...spec.up);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    // Shift the composition upward by 5% to leave the floating tool dock clear.
    camera.setViewOffset(width, height, 0, height * 0.05, width, height);
    camera.updateProjectionMatrix();
    cameraRef.current = camera;
    setZoomPercent(100);
    // OrbitControls caches its up-axis internally, so rebind when switching projection/preset.
    controlsRef.current?.dispose();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.target.copy(target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = Math.max(2, radius * 0.15);
    controls.maxDistance = Math.max(900, radius * 25);
    controls.minZoom = 0.0001;
    controls.maxZoom = 1000;
    controls.addEventListener('change', requestRenderRef.current);
    controls.update();
    controlsRef.current = controls;
    requestRenderRef.current();
  }, []);

  // Initialize WebGLRenderer & Scene once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const width = Math.max(1, container.clientWidth || 640);
    const height = Math.max(1, container.clientHeight || 480);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      setRenderError(null);
    } catch {
      setRenderError('此浏览器暂时无法启动三维视图。请开启硬件加速后刷新；二维绘图与模型文件导出仍可使用。');
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setRenderError('三维渲染连接已中断。请先保存工程，再刷新网页恢复。');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08090b);
    scene.fog = new THREE.FogExp2(0x08090b, 0.0015);
    sceneRef.current = scene;

    // Studio RoomEnvironment reflection map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();
    scene.environmentIntensity = 0.7;

    // Z-up CAD Perspective Camera
    const camera = new THREE.PerspectiveCamera(42, width / height, 1, 2500);
    camera.up.set(0, 0, 1);
    camera.position.set(145, -165, 130);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.target.set(0, 0, 15);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controls.minDistance = 25;
    controls.maxDistance = 900;
    controls.update();
    controlsRef.current = controls;

    // Use camera.zoom for both wheel and numeric controls in either projection.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.buttons) return;
      const currentCamera = cameraRef.current;
      const currentControls = controlsRef.current;
      if (!currentCamera || !currentControls) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const cursor = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(currentCamera.getWorldDirection(new THREE.Vector3()), currentControls.target);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(cursor, currentCamera);
      const before = ray.ray.intersectPlane(plane, new THREE.Vector3());
      currentCamera.zoom = wheelZoom(currentCamera.zoom, event.deltaY, event.deltaMode, rect.height, 0.0001, 1000);
      currentCamera.updateProjectionMatrix();
      ray.setFromCamera(cursor, currentCamera);
      const after = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (before && after) {
        const shift = before.sub(after);
        currentCamera.position.add(shift);
        currentControls.target.add(shift);
      }
      currentControls.update();
      setZoomPercent(currentCamera.zoom * 100);
      requestRenderRef.current();
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // Studio 3-point warm/cool lighting rig (Z-up)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xaab0bb, 0.85);
    hemiLight.position.set(0, 0, 200);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(120, -140, 220);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 600;
    const d = 140;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe8edf5, 0.55);
    rimLight.position.set(-140, 150, 110);
    scene.add(rimLight);

    // CAD Build Plate & Coordinate Axes Group (composite grounded platform)
    const buildPlateGroup = new THREE.Group();
    buildPlateGroupRef.current = buildPlateGroup;

    // Soft radial contact shadow plane at z = -0.15
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(64, 64, 8, 64, 64, 62);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.30)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(185, 150),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    shadowPlane.position.z = -0.15;
    buildPlateGroup.add(shadowPlane);

    // XY Grid on Z = 0 — 随场景内容动态延伸，细网格间距与 2D 吸附步长联动
    const disposeGridGroup = () => {
      const existing = buildPlateGroup.getObjectByName('xyGridGroup');
      if (existing) {
        buildPlateGroup.remove(existing);
        (existing as THREE.Group).children.forEach((child) => {
          const line = child as THREE.GridHelper;
          line.geometry?.dispose();
          const mat = line.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        });
      }
    };
    disposeGridGroup();
    {
      const allVisible = shapesRef.current.filter(isVisibleShape);
      let extent = 120; // 空场景最小半径
      if (allVisible.length > 0) {
        const pts = allVisible.flatMap((s) =>
          s.holePoints ? [...s.points, ...s.holePoints] : s.points,
        );
        const b = computeBounds2D(pts);
        const reach = Math.max(
          Math.abs(b.minX),
          Math.abs(b.maxX),
          Math.abs(b.minY),
          Math.abs(b.maxY),
        );
        extent = Math.max(60, Math.ceil((reach * 1.35) / 10) * 10);
      }
      const size = extent * 2;
      const minor = Math.max(10, Math.round(gridStep));
      const major = minor * 5;
      const gridGroup = new THREE.Group();
      gridGroup.name = 'xyGridGroup';
      const minorGrid = new THREE.GridHelper(
        size,
        Math.max(4, Math.round(size / minor)),
        0x20242a,
        0x14171b,
      );
      minorGrid.rotation.x = Math.PI / 2;
      minorGrid.position.z = -0.06;
      const majorGrid = new THREE.GridHelper(
        size,
        Math.max(2, Math.round(size / major)),
        0x252b33,
        0x252b33,
      );
      majorGrid.rotation.x = Math.PI / 2;
      majorGrid.position.z = -0.05;
      gridGroup.add(minorGrid);
      gridGroup.add(majorGrid);
      buildPlateGroup.add(gridGroup);
    }

    // Custom XYZ Axes lines (+X Red, +Y Green, +Z Blue)
    const axisLen = 105;
    const createAxisLine = (end: [number, number, number], colorHex: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0.08),
        new THREE.Vector3(...end),
      ]);
      return new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: colorHex, linewidth: 2 }),
      );
    };
    buildPlateGroup.add(createAxisLine([axisLen, 0, 0.08], 0x596473)); // X datum
    buildPlateGroup.add(createAxisLine([0, axisLen, 0.08], 0x596473)); // Y datum

    scene.add(buildPlateGroup);

    const meshesGroup = new THREE.Group();
    meshesGroupRef.current = meshesGroup;
    scene.add(meshesGroup);

    // On-demand render scheduler with software-WebGL fence pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
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
        controlsRef.current?.update();
        renderer.render(scene, cameraRef.current ?? camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;
    controls.addEventListener('change', requestRender);

    // Select only a stationary primary-button gesture; orbiting must preserve selection.
    let selectionGesture: { pointerId: number; x: number; y: number; dragged: boolean } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      selectionGesture = e.isPrimary && e.button === 0
        ? { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dragged: false }
        : null;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (selectionGesture?.pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX - selectionGesture.x, e.clientY - selectionGesture.y) > 6) {
        selectionGesture.dragged = true;
      }
    };
    const onPointerCancel = () => {
      selectionGesture = null;
    };
    const onPointerUp = (e: PointerEvent) => {
      const gesture = selectionGesture;
      selectionGesture = null;
      if (!gesture || gesture.pointerId !== e.pointerId || e.button !== 0 || gesture.dragged) return;
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_mouse, cameraRef.current ?? camera);
      const hits = _raycaster.intersectObjects(interactablesRef.current, false);
      const pointHit = hits.find((hit) => (hit.object as THREE.Points).isPoints);
      const referenceHit = hits.find((hit) => hit.object.userData.sketchReference);
      const hitShapeId = (pointHit ?? referenceHit ?? hits[0])?.object.userData?.shapeId;
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (hitShapeId) {
        onSelectShapeRef.current(hitShapeId, e.ctrlKey || e.metaKey, e.shiftKey);
      } else if (!additive) {
        onSelectShapeRef.current(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 16 || h < 16) return;
      const currentCamera = cameraRef.current;
      const currentControls = controlsRef.current;
      if (!currentCamera || !currentControls) return;
      const aspect = w / h;
      if (currentCamera instanceof THREE.PerspectiveCamera) {
        const factor = Math.max(1, 1 / aspect) / Math.max(1, 1 / currentCamera.aspect);
        currentCamera.position.sub(currentControls.target).multiplyScalar(factor).add(currentControls.target);
        currentCamera.aspect = aspect;
      } else {
        const baseHeight = Number(currentCamera.userData.baseHalfHeight) || 100;
        const baseAspect = Number(currentCamera.userData.baseAspect) || 1;
        const halfHeight = baseHeight * Math.max(1, baseAspect / aspect);
        currentCamera.left = -halfHeight * aspect;
        currentCamera.right = halfHeight * aspect;
        currentCamera.top = halfHeight;
        currentCamera.bottom = -halfHeight;
      }
      currentCamera.setViewOffset(w, h, 0, h * 0.05, w, h);
      currentCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      controlsRef.current?.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      disposeShapeGroup(meshesGroup);
      meshesGroup.clear();
      pointMarkerTextureRef.current?.dispose();
      pointMarkerTextureRef.current = null;
      interactablesRef.current = [];
      meshesGroupRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, [syncSceneMeshes]);

  // Trigger scene rebuild whenever shapes, selection, explodedFactor, wireframeOverlay or gridStep changes
  useEffect(() => {
    syncSceneMeshes();
  }, [shapes, selectedIds, explodedFactor, wireframeOverlay, gridStep, syncSceneMeshes]);

  // Update camera when activeView changes
  useEffect(() => {
    applyCameraPreset(activeView);
  }, [activeView, fitRequest, applyCameraPreset]);

  // Toggle build plate & grid visibility
  useEffect(() => {
    if (buildPlateGroupRef.current) {
      buildPlateGroupRef.current.visible = showGrid;
      requestRenderRef.current();
    }
  }, [showGrid]);

  // Register multi-view exporter API for All-Views PNG & Engineering Sheet export
  useEffect(() => {
    const captureSingleView = (
      viewId: CameraViewId,
      width = 640,
      height = 480,
    ): string => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const mainCamera = cameraRef.current;
      if (!renderer || !scene || !mainCamera) return '';

      const spec = CAMERA_VIEWS.find((v) => v.id === viewId) ?? CAMERA_VIEWS[0];
      const sceneMetrics = computeSceneMetrics(shapesRef.current);
      const maxSpan = Math.max(
        105,
        sceneMetrics.bounds.widthX * 1.15,
        sceneMetrics.bounds.depthY * 1.15,
        sceneMetrics.bounds.heightZ * 1.4,
      );
      const target = getSceneTarget(shapesRef.current);
      const dist = maxSpan * 1.8;
      const dir = new THREE.Vector3(...(spec.id === 'isometric' ? [1, -1, 1] as const : spec.positionDir)).normalize();

      // Save current renderer size
      const origSize = new THREE.Vector2();
      renderer.getSize(origSize);

      renderer.setSize(width, height, false);

      let renderCam: THREE.Camera;
      if (spec.orthographic) {
        const aspect = width / height;
        const frustum = maxSpan * 0.78;
        const ortho = new THREE.OrthographicCamera(
          -frustum * aspect,
          frustum * aspect,
          frustum,
          -frustum,
          1,
          2000,
        );
        ortho.up.set(...spec.up);
        ortho.position.set(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
        ortho.lookAt(target.x, target.y, target.z);
        ortho.updateProjectionMatrix();
        renderCam = ortho;
      } else {
        const persp = new THREE.PerspectiveCamera(40, width / height, 1, 2000);
        persp.up.set(...spec.up);
        persp.position.set(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
        persp.lookAt(target.x, target.y, target.z);
        persp.updateProjectionMatrix();
        renderCam = persp;
      }

      // Synchronous render right before toDataURL() as required by WebGL spec
      renderer.render(scene, renderCam);
      const dataUrl = renderer.domElement.toDataURL('image/png');

      // Restore main viewport size & camera
      renderer.setSize(origSize.x, origSize.y, false);
      renderer.render(scene, mainCamera);

      return dataUrl;
    };

    const captureAllStandardViews = (): RenderedViewCapture[] => {
      const order: CameraViewId[] = [
        'isometric',
        'top',
        'front',
        'right',
        'left',
        'back',
        'bottom',
        'perspective',
      ];
      return order.map((id) => {
        const spec = CAMERA_VIEWS.find((v) => v.id === id)!;
        return {
          id,
          label: spec.label,
          axisDesc: spec.axisDesc,
          dataUrl: captureSingleView(id, 560, 420),
        };
      });
    };

    const generateEngineeringSheetPng = (): string => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const mainCamera = cameraRef.current;
      if (!renderer || !scene || !mainCamera) return '';

      const sheet = document.createElement('canvas');
      sheet.width = 1600;
      sheet.height = 1120;
      const ctx = sheet.getContext('2d');
      if (!ctx) return '';

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 1600, 1120);

      // Outer CAD Blueprint border
      ctx.strokeStyle = '#D5DAE2';
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 20, 1560, 1080);

      // Header Banner
      ctx.fillStyle = '#F4F5F7';
      ctx.fillRect(22, 22, 1556, 64);
      ctx.strokeStyle = '#D5DAE2';
      ctx.strokeRect(22, 22, 1556, 64);

      ctx.fillStyle = '#181A1F';
      ctx.font = 'bold 20px "Plus Jakarta Sans", "Noto Sans SC", sans-serif';
      ctx.fillText(
        t('ExtrudeCAD Studio / 全视图工程图'),
        44,
        48,
      );

      const metrics = computeSceneMetrics(shapesRef.current);
      ctx.fillStyle = '#0066FF';
      ctx.font = '500 13px "JetBrains Mono", "Noto Sans SC", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(
        t(`包络尺寸: ${metrics.bounds.widthX} × ${metrics.bounds.depthY} × ${metrics.bounds.heightZ} mm  ·  总体积: ${metrics.totalVolumeCm3} cm³  ·  预估总重: ${metrics.totalWeightGrams} g`),
        1556,
        72,
      );
      ctx.textAlign = 'left';

      // Save original renderer dimensions
      const origSize = new THREE.Vector2();
      renderer.getSize(origSize);
      const cellW = 368;
      const cellH = 290;
      renderer.setSize(cellW, cellH, false);

      const maxSpan = Math.max(
        105,
        metrics.bounds.widthX * 1.15,
        metrics.bounds.depthY * 1.15,
        metrics.bounds.heightZ * 1.4,
      );
      const target = getSceneTarget(shapesRef.current);
      const dist = maxSpan * 1.8;

      const viewOrder: CameraViewId[] = [
        'isometric',
        'top',
        'front',
        'right',
        'perspective',
        'bottom',
        'back',
        'left',
      ];

      const previousBackground = scene.background;
      const previousFog = scene.fog;
      const buildPlate = buildPlateGroupRef.current;
      const previousPlateVisibility = buildPlate?.visible;
      scene.background = new THREE.Color(0xf4f5f7);
      scene.fog = new THREE.FogExp2(0xf4f5f7, 0.0015);
      if (buildPlate) buildPlate.visible = false;
      try {
      viewOrder.forEach((vId, idx) => {
        const col = idx % 4;
        const row = Math.floor(idx / 4);
        const x = 36 + col * (cellW + 18);
        const y = 104 + row * (cellH + 46);

        const spec = CAMERA_VIEWS.find((v) => v.id === vId)!;
        const dir = new THREE.Vector3(...(spec.id === 'isometric' ? [1, -1, 1] as const : spec.positionDir)).normalize();

        let renderCam: THREE.Camera;
        if (spec.orthographic) {
          const aspect = cellW / cellH;
          const frustum = maxSpan * 0.78;
          const ortho = new THREE.OrthographicCamera(
            -frustum * aspect,
            frustum * aspect,
            frustum,
            -frustum,
            1,
            2000,
          );
          ortho.up.set(...spec.up);
          ortho.position.set(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
          ortho.lookAt(target.x, target.y, target.z);
          ortho.updateProjectionMatrix();
          renderCam = ortho;
        } else {
          const persp = new THREE.PerspectiveCamera(40, cellW / cellH, 1, 2000);
          persp.up.set(...spec.up);
          persp.position.set(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
          persp.lookAt(target.x, target.y, target.z);
          persp.updateProjectionMatrix();
          renderCam = persp;
        }

        renderer.render(scene, renderCam);
        ctx.drawImage(renderer.domElement, x, y, cellW, cellH);

        ctx.strokeStyle = '#D5DAE2';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cellW, cellH);

        // View title strip
        ctx.fillStyle = '#F4F5F7';
        ctx.fillRect(x, y + cellH, cellW, 28);
        ctx.strokeRect(x, y + cellH, cellW, 28);
        ctx.fillStyle = '#181A1F';
        ctx.font = '600 12px "Plus Jakarta Sans", "Noto Sans SC", sans-serif';
        ctx.fillText(t(spec.label), x + 10, y + cellH + 18);
        ctx.fillStyle = '#68707E';
        ctx.font = '500 11px "JetBrains Mono", "Noto Sans SC", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(t(spec.axisDesc), x + cellW - 10, y + cellH + 18);
        ctx.textAlign = 'left';
      });

      } finally {
        scene.background = previousBackground;
        scene.fog = previousFog;
        if (buildPlate && previousPlateVisibility !== undefined) buildPlate.visible = previousPlateVisibility;
        renderer.setSize(origSize.x, origSize.y, false);
        renderer.render(scene, mainCamera);
      }

      // Footer BOM / Parts Summary Table
      const tableY = 788;
      ctx.fillStyle = '#F4F5F7';
      ctx.fillRect(36, tableY, 1526, 290);
      ctx.strokeStyle = '#D5DAE2';
      ctx.strokeRect(36, tableY, 1526, 290);

      ctx.fillStyle = '#0066FF';
      ctx.font = 'bold 14px "Plus Jakarta Sans", "Noto Sans SC", sans-serif';
      ctx.fillText(t('模型构件明细表 (CAD Extruded Parts Schedule)'), 54, tableY + 28);

      const visibleShapes = shapesRef.current.filter((s) => s.visible);
      ctx.font = '500 12px "JetBrains Mono", "Noto Sans SC", monospace';
      ctx.fillStyle = '#68707E';
      ctx.fillText(
        t('序号    构件名称 (Part Name)                  XY包络尺寸 (mm)        Z拉伸高度 / 起始Z        2D净面积          3D体积 / 质量'),
        54,
        tableY + 56,
      );

      visibleShapes.slice(0, 7).forEach((s, i) => {
        const m = computeShapeMetrics(s);
        const ry = tableY + 84 + i * 26;
        ctx.fillStyle = s.color;
        ctx.fillRect(54, ry - 10, 10, 10);
        ctx.fillStyle = '#181A1F';
        const namePad = s.name.slice(0, 22).padEnd(24, ' ');
        const xyPad = `${m.widthX} × ${m.depthY} mm`.padEnd(18, ' ');
        const zPad = `Z:${m.heightZ}mm (偏移:${s.zOffset}mm)`.padEnd(22, ' ');
        const areaPad = `${m.areaMm2} mm²`.padEnd(16, ' ');
        const volStr = `${m.volumeCm3} cm³ (${m.weightGrams} g)`;
        ctx.fillText(
          t(`#${i + 1}     ${namePad}  ${xyPad}  ${zPad}  ${areaPad}  ${volStr}`),
          72,
          ry,
        );
      });

      if (visibleShapes.length > 7) {
        ctx.fillStyle = '#68707E';
        ctx.font = '12px sans-serif';
        ctx.fillText(t(`本表显示前 7 个构件；另有 ${visibleShapes.length - 7} 个构件，完整设计请保存工程文件。`), 54, 1090);
      }

      return sheet.toDataURL('image/png');
    };

    onRegisterExporter({
      captureSingleView,
      captureAllStandardViews,
      generateEngineeringSheetPng,
    });
  }, [onRegisterExporter]);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#08090b] select-none overflow-hidden">
      <div className="h-9 px-3 flex items-center justify-between gap-3 bg-[var(--paper)] border-b border-[var(--line)] shrink-0 z-10 overflow-x-auto">
        <div role="toolbar" aria-label={t("三维相机视角切换")} className="camera-tabs flex items-center gap-1 shrink-0">
          <span className="text-[11px] font-semibold text-[var(--ink)] mr-3">{t("三维模型")}</span>
          {t(CAMERA_VIEWS.slice(0, 5).map((view) => <button key={view.id} type="button" onClick={() => onChangeView(view.id)} aria-pressed={activeView === view.id} className={`h-6 px-2.5 text-[11px] rounded transition-colors ${activeView === view.id ? 'bg-[var(--selection)] text-[var(--blue)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}>{t(view.shortLabel)}</button>))}
        </div>
        <select className="camera-select h-7 rounded border border-[var(--line)] bg-[var(--paper)] px-2 text-xs text-[var(--muted)]" aria-label={t("三维相机视角")} value={activeView} onChange={(event) => onChangeView(event.target.value as CameraViewId)}>
          {t(CAMERA_VIEWS.slice(0, 5).map((view) => <option key={view.id} value={view.id}>{t(view.shortLabel)}</option>))}
        </select>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={onToggleWireframe} aria-pressed={wireframeOverlay} title={t("显示 / 隐藏边线")} className={`h-6 px-2 flex items-center gap-1.5 text-[11px] rounded ${wireframeOverlay ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}><Box className="w-3.5 h-3.5" />{t("边线")}</button>
          <button type="button" onClick={() => setShowGrid(g => !g)} aria-pressed={showGrid} title={t("显示 / 隐藏网格")} className={`h-6 px-2 flex items-center gap-1.5 text-[11px] rounded ${showGrid ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}><Grid className="w-3.5 h-3.5" />{t("网格")}</button>
          <button type="button" onClick={() => applyCameraPreset(activeView)} aria-label={t("重置三维相机视角")} title={t("适合视图")} className="p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] rounded"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Dedicated Empty WebGL Mount Container (Stable Lifecycle) */}
      <ViewZoomControls label={t("三维")} percent={zoomPercent} onChange={changeZoomPercent} onFit={() => applyCameraPreset(activeView)} />
      <div className="relative flex-1 min-h-0 w-full">
        <div
          ref={canvasMountRef}
          data-testid="cad-3d-viewport"
          className="w-full h-full"
        />

        {t(renderError && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center bg-[var(--paper)] p-8">
            <div className="max-w-sm text-center text-sm text-[var(--muted)] leading-relaxed">
              <Box className="w-9 h-9 mx-auto mb-4 text-[var(--muted)]" />
              <p className="font-semibold text-[var(--ink)] mb-2">{t("三维预览暂不可用")}</p>
              <p>{t(renderError)}</p>
            </div>
          </div>
        ))}

        <div className="absolute top-4 right-4 pointer-events-none flex items-center gap-3 text-[10px] font-mono text-[var(--muted)]"><span>X</span><span>Y</span><span>Z</span><span className="border-l border-[var(--line)] pl-3">mm</span></div>
      </div>
    </div>
  );
};





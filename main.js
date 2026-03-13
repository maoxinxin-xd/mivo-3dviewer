import * as THREE from 'three';
import { GLBMaterialExtractor } from './lib/model.js';

// ======================== DOM refs ========================
const modelViewer = document.getElementById('modelViewer');
const app = document.getElementById('app');
const loadingEl = document.getElementById('loadingProgress');
const emptyState = document.getElementById('emptyState');
const emptyDropzone = document.getElementById('emptyDropzone');
const progressText = document.getElementById('progressText');
const triangleCountEl = document.getElementById('triangleCount');
const leftPanel = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
const bottomPanel = document.getElementById('bottomPanel');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadLabel = document.getElementById('uploadLabel');
const screenshotBtn = document.getElementById('screenshotBtn');
const lightSlider = document.getElementById('lightSlider');
const lightNumber = document.getElementById('lightNumber');
const ambientSlider = document.getElementById('ambientSlider');
const ambientNumber = document.getElementById('ambientNumber');
const shaderRound = document.getElementById('shaderRound');
const angleSphere = document.getElementById('angleSphere');
const angleCenterDot = document.getElementById('angleCenterDot');

// ======================== State ========================
let currentModelBlob = null;
let currentFileName = '';
let blobUrl = '';
let isUploading = false;
let currentProgress = 0;
let scale = 48;
let projectionMode = 'perspective';
let presetView = 'front';
let currentTexture = '贴图';
let isWhiteModel = false;

let angle = 0;
let lightIntensity = 2;
let ambientLightIntensityVal = 0;

let directionalLight = null;
let ambientLight = null;
let isDragging = false;

// ======================== Cache ========================
const CACHE_NAME = 'model-cache';
const CACHE_METADATA_KEY = 'model-cache-metadata';
const MAX_CACHE_SIZE = 20;

function fileFingerprint(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

async function getCacheMetadata() {
  try {
    const m = localStorage.getItem(CACHE_METADATA_KEY);
    return m ? JSON.parse(m) : [];
  } catch { return []; }
}

async function updateCacheMetadata(key) {
  try {
    let meta = await getCacheMetadata();
    meta = meta.filter(k => k !== key);
    meta.unshift(key);
    if (meta.length > MAX_CACHE_SIZE) {
      const toRemove = meta.slice(MAX_CACHE_SIZE);
      meta = meta.slice(0, MAX_CACHE_SIZE);
      if ('caches' in window) {
        const cache = await caches.open(CACHE_NAME);
        for (const id of toRemove) await cache.delete(id);
      }
    }
    localStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(meta));
  } catch (e) { console.warn('更新缓存元数据失败:', e); }
}

async function getModelFromCache(key) {
  if (!('caches' in window) || !key) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(key);
    if (resp) { await updateCacheMetadata(key); return await resp.blob(); }
  } catch (e) { console.warn('从缓存获取模型失败:', e); }
  return null;
}

async function saveModelToCache(key, blob) {
  if (!('caches' in window) || !key) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(key, new Response(blob));
    await updateCacheMetadata(key);
  } catch (e) { console.warn('保存模型到缓存失败:', e); }
}

// ======================== Camera constants ========================
const CAMERA_CONFIG = {
  PERSPECTIVE_FOV: 45,
  NEAR_CLIP: 0.01,
  FAR_CLIP: 10000,
  ORTHO_NEAR: -10000,
  ORTHO_FAR: 10000,
};

function convertRadiusToPerspective(radius, fieldOfView) {
  return fieldOfView < 1 ? (radius * fieldOfView) / CAMERA_CONFIG.PERSPECTIVE_FOV : radius;
}

function sphericalToCartesian(theta, phi, radius) {
  return {
    x: radius * Math.sin(phi) * Math.sin(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.cos(theta)
  };
}

function calculateOrthographicViewSize(radius) {
  const fovRad = (CAMERA_CONFIG.PERSPECTIVE_FOV * Math.PI) / 180;
  return 2 * radius * Math.tan(fovRad / 2);
}

function replaceModelViewerCamera(camera, type) {
  const symbols = Object.getOwnPropertySymbols(modelViewer);
  for (const sym of symbols) {
    const value = modelViewer[sym];
    if (value && value.camera) {
      value.camera = camera;
      if (modelViewer.jumpCameraToGoal) modelViewer.jumpCameraToGoal();
      syncCameraWithModelViewer(camera, type);
      break;
    }
  }
}

function calculateScale() {
  const dims = modelViewer.getDimensions();
  const diag = Math.sqrt(dims.x ** 2 + dims.y ** 2 + dims.z ** 2).toFixed(2);
  return (70 / parseFloat(diag)) / 48.27;
}

// ======================== Camera init ========================
function initCamera() {
  const orbit = modelViewer.getCameraOrbit();
  const fov = modelViewer.getFieldOfView();
  const newRadius = (orbit.radius * fov) / CAMERA_CONFIG.PERSPECTIVE_FOV;

  modelViewer.cameraOrbit = `0deg 90deg ${newRadius * 1.5}m`;
  modelViewer.fieldOfView = `${CAMERA_CONFIG.PERSPECTIVE_FOV}deg`;
  modelViewer.minFieldOfView = `${CAMERA_CONFIG.PERSPECTIVE_FOV}deg`;
  modelViewer.maxFieldOfView = `${CAMERA_CONFIG.PERSPECTIVE_FOV}deg`;
  modelViewer.maxCameraOrbit = `3600deg 3600deg ${5 / scale}m`;
  modelViewer.minCameraOrbit = `-3600deg -3600deg ${0.3 / scale}m`;

  projectionMode = 'perspective';
  const cam = createCamera('perspective');
  replaceModelViewerCamera(cam, 'perspective');
}

function syncCameraWithModelViewer(camera, type) {
  const sync = () => {
    const orbit = modelViewer.getCameraOrbit();
    const fov = modelViewer.getFieldOfView();
    const radius = convertRadiusToPerspective(orbit.radius, fov);
    const pos = sphericalToCartesian(orbit.theta, orbit.phi, radius);
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(0, 0, 0);

    if (type === 'orthographic' && camera instanceof THREE.OrthographicCamera) {
      updateOrthographicCamera(camera, radius);
    } else if (type === 'perspective' && camera instanceof THREE.PerspectiveCamera) {
      updatePerspectiveCamera(camera);
    }
  };
  sync();
  modelViewer.removeEventListener('camera-change', sync);
  modelViewer.addEventListener('camera-change', sync);
}

function updateOrthographicCamera(camera, radius) {
  const aspect = window.innerWidth / window.innerHeight;
  const viewSize = calculateOrthographicViewSize(radius);
  camera.left = -viewSize * aspect / 2;
  camera.right = viewSize * aspect / 2;
  camera.top = viewSize / 2;
  camera.bottom = -viewSize / 2;
  camera.updateProjectionMatrix();
}

function updatePerspectiveCamera(camera) {
  const aspect = window.innerWidth / window.innerHeight;
  if (Math.abs(camera.aspect - aspect) > 0.01) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

function createCamera(targetType) {
  const orbit = modelViewer.getCameraOrbit();
  const fov = modelViewer.getFieldOfView();
  const aspect = window.innerWidth / window.innerHeight;
  const radius = convertRadiusToPerspective(orbit.radius, fov);
  const pos = sphericalToCartesian(orbit.theta, orbit.phi, radius);

  if (targetType === 'orthographic') {
    const viewSize = calculateOrthographicViewSize(radius);
    const cam = new THREE.OrthographicCamera(
      -viewSize * aspect / 2, viewSize * aspect / 2,
      viewSize / 2, -viewSize / 2,
      CAMERA_CONFIG.ORTHO_NEAR, CAMERA_CONFIG.ORTHO_FAR
    );
    cam.position.set(pos.x, pos.y, pos.z);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    return cam;
  } else {
    const cam = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.PERSPECTIVE_FOV, aspect,
      CAMERA_CONFIG.NEAR_CLIP, CAMERA_CONFIG.FAR_CLIP
    );
    cam.position.set(pos.x, pos.y, pos.z);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    return cam;
  }
}

// ======================== Scene helpers ========================
function getThreeScene() {
  if (!modelViewer || !modelViewer.model) return null;
  const model = modelViewer.model;
  const symbols = Object.getOwnPropertySymbols(model);
  for (const sym of symbols) {
    const key = sym.toString();
    if (key.includes('hierarchy') || key.includes('roots')) {
      const nodes = model[sym];
      if (Array.isArray(nodes) && nodes.length > 0) {
        for (const node of nodes) {
          if (node.modelNode || node.mesh || node.object3D) {
            const obj3d = node.modelNode || node.mesh || node.object3D;
            if (obj3d && obj3d.parent) return obj3d.parent;
            if (obj3d && (obj3d.isScene || obj3d.children)) return obj3d;
          }
          if (node.isScene || (node.children && node.traverse)) return node;
          if (node.parent && (node.parent.isScene || node.parent.children)) return node.parent;
        }
      }
    }
  }
  return null;
}

function getRootScene() {
  try {
    const renderer = modelViewer.renderer;
    if (renderer && renderer.scene && renderer.scene.isScene) return renderer.scene;
    if (modelViewer.scene && modelViewer.scene.isScene) return modelViewer.scene;
    const symbols = Object.getOwnPropertySymbols(modelViewer);
    for (const sym of symbols) {
      const value = modelViewer[sym];
      if (value && value.scene && value.scene.isScene) return value.scene;
      if (value && value.renderer && value.renderer.scene && value.renderer.scene.isScene) return value.renderer.scene;
    }
    const modelScene = getThreeScene();
    if (modelScene) {
      let current = modelScene;
      while (current && current.parent) current = current.parent;
      if (current && current.isScene) return current;
    }
  } catch (e) { console.warn('获取根场景失败:', e); }
  return getThreeScene();
}

// ======================== Grid ========================
function addGroundGrid() {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const dims = modelViewer.getDimensions();
  const maxDim = Math.max(dims.x, dims.y, dims.z);
  const grid = new THREE.GridHelper(maxDim * 150, 200, 0x4e4e4e, 0x4e4e4e);
  grid.name = 'groundGrid';
  grid.position.y = -(dims.y) / 2;
  grid.raycast = () => {};
  rootScene.add(grid);
}

function changeGroundGrid(type) {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const grid = rootScene.getObjectByName('groundGrid');
  if (!grid) return;
  const exp = modelViewer.exposure;
  if (type === 'remove') {
    grid.visible = false;
    modelViewer.exposure = exp + 0.1;
    modelViewer.exposure = exp;
  } else {
    grid.visible = true;
    modelViewer.exposure = exp - 0.1;
    modelViewer.exposure = exp;
  }
}

// ======================== Triangle count ========================
function getTriangleCount() {
  let total = 0;
  const scene = getThreeScene();
  if (!scene) return;
  scene.traverse((child) => {
    if (child.isMesh && child.geometry) {
      if (child.geometry.index) total += child.geometry.index.count / 3;
      else if (child.geometry.attributes.position) total += child.geometry.attributes.position.count / 3;
    }
  });
  triangleCountEl.textContent = Math.floor(total).toLocaleString();
}

// ======================== Material views ========================
function restoreOriginalMaterial() {
  if (currentTexture === '贴图') return;
  currentTexture = '贴图';
  const scene = getThreeScene();
  if (!scene) return;
  scene.traverse((child) => {
    if (child.isMesh && child.userData.originalMaterial) {
      child.material = child.userData.originalMaterial;
    }
  });
  modelViewer.exposure = 1;
  refreshTextureButtons();
}

function switchToNormalMapDisplay() {
  if (currentTexture === '法线') return;
  currentTexture = '法线';
  const scene = getThreeScene();
  if (!scene) return;
  const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, flatShading: true });
  scene.traverse((child) => {
    if (child.isMesh) {
      if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
      if (child.geometry && !child.geometry.attributes.normal) child.geometry.computeVertexNormals();
      child.material = normalMat;
    }
  });
  modelViewer.exposure = 0.9;
  refreshTextureButtons();
}

function showWhiteModel() {
  currentTexture = '白膜';
  const scene = getThreeScene();
  if (!scene) return;
  scene.traverse((child) => {
    if (child.isMesh) {
      if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
      if (child.geometry && !child.geometry.attributes.normal) child.geometry.computeVertexNormals();
      child.material = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.9, metalness: 0.0,
        side: THREE.DoubleSide, flatShading: true
      });
    }
  });
  modelViewer.exposure = 0.3;
  refreshTextureButtons();
}

function extractAlbedoFromMaterial(material) {
  if (!material) return { texture: null, color: new THREE.Color(0xffffff) };
  let map = null;
  if (material.map && (material.map instanceof THREE.Texture || (typeof material.map === 'object' && material.map.image))) map = material.map;
  else if (material.baseColorMap && material.baseColorMap instanceof THREE.Texture) map = material.baseColorMap;
  else if (material.diffuseMap && material.diffuseMap instanceof THREE.Texture) map = material.diffuseMap;
  else if (material.baseColorTexture && material.baseColorTexture instanceof THREE.Texture) map = material.baseColorTexture;
  else if (material.emissiveMap && (material.emissiveMap instanceof THREE.Texture || (typeof material.emissiveMap === 'object' && material.emissiveMap.image))) map = material.emissiveMap;

  let colorValue = null;
  if (material.color) colorValue = material.color;
  else if (material.baseColor) {
    if (material.baseColor instanceof THREE.Color) colorValue = material.baseColor;
    else if (Array.isArray(material.baseColor)) colorValue = new THREE.Color().fromArray(material.baseColor);
    else if (typeof material.baseColor === 'object' && material.baseColor.r !== undefined) colorValue = new THREE.Color(material.baseColor.r, material.baseColor.g, material.baseColor.b);
    else colorValue = material.baseColor;
  } else if (material.diffuse) colorValue = material.diffuse;

  let color;
  if (colorValue instanceof THREE.Color) color = colorValue.clone();
  else if (colorValue !== null && colorValue !== undefined) {
    try {
      const n = typeof colorValue === 'number' ? colorValue : parseInt(colorValue);
      color = n === 0 ? new THREE.Color(0xffffff) : new THREE.Color(colorValue);
    } catch { color = new THREE.Color(0xffffff); }
  } else color = new THREE.Color(0xffffff);

  if (map) {
    const hex = color.getHex();
    if (hex === 0x000000 || (hex < 0x333333 && hex > 0)) color = new THREE.Color(0xffffff);
  } else if (color.getHex() === 0x000000) color = new THREE.Color(0xffffff);

  return { texture: map, color };
}

function switchToAlbedoMap() {
  if (currentTexture === '反照') return;
  currentTexture = '反照';
  const scene = getThreeScene();
  if (!scene) return;
  scene.traverse((child) => {
    if (!child.isMesh) return;
    if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
    const origMat = child.userData.originalMaterial;
    const mats = Array.isArray(origMat) ? origMat : [origMat];
    const newMats = mats.map((mat) => {
      if (mat?._albedoMaterial) return mat._albedoMaterial;
      const { texture, color } = extractAlbedoFromMaterial(mat);
      const albedo = new THREE.MeshBasicMaterial({
        map: texture, color, side: THREE.DoubleSide,
        transparent: texture ? texture.transparent : false,
        alphaTest: texture ? texture.alphaTest : undefined
      });
      mat._albedoMaterial = albedo;
      return albedo;
    });
    child.material = Array.isArray(origMat) ? newMats : newMats[0];
  });
  modelViewer.exposure = 0.8;
  refreshTextureButtons();
}

function refreshTextureButtons() {
  document.querySelectorAll('#textureBar .texture-icon-container').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.texture === currentTexture);
    const isHidden = isWhiteModel && (btn.dataset.texture === '贴图' || btn.dataset.texture === '反照');
    btn.style.display = isHidden ? 'none' : '';
  });
}

// ======================== Lighting ========================
function addDirectionalLight() {
  const scene = getThreeScene();
  if (!scene) return;
  if (directionalLight) {
    if (directionalLight.parent) directionalLight.parent.remove(directionalLight);
    directionalLight.dispose();
  }
  const light = new THREE.DirectionalLight(0xffffff, lightIntensity);
  light.name = 'customDirectionalLight';
  updateLightDirection(light);
  scene.add(light);
  directionalLight = light;
}

function updateLightDirection(light) {
  const target = light || directionalLight;
  if (!target) return;

  const rad = (angle - 90) * (Math.PI / 180);
  const x = Math.cos(rad), z = Math.sin(rad), y = 0.5;
  target.position.set(x * 10, y * 10, z * 10);
  target.target.position.set(0, 0, 0);
  target.target.updateMatrixWorld();
  nudgeExposure();
}

function updateLightIntensityVal() {
  if (directionalLight) {
    directionalLight.intensity = lightIntensity;
    nudgeExposure();
  }
}

function addAmbientLight() {
  const scene = getThreeScene();
  if (!scene) return;
  if (ambientLight) {
    if (ambientLight.parent) ambientLight.parent.remove(ambientLight);
    ambientLight.dispose();
  }
  const light = new THREE.AmbientLight(0xffffff, ambientLightIntensityVal);
  light.name = 'customAmbientLight';
  scene.add(light);
  ambientLight = light;
}

function updateAmbientLightIntensity() {
  if (ambientLight) ambientLight.intensity = ambientLightIntensityVal;

  const scene = getThreeScene();
  if (scene) {
    scene.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (mat.emissive && mat.emissive.getHex() !== 0x000000) {
            mat.emissiveIntensity = 1 + (ambientLightIntensityVal / 20) * 19;
            mat.needsUpdate = true;
          }
        });
      }
    });
  }
  nudgeExposure();
}

function nudgeExposure() {
  const exp = modelViewer.exposure;
  modelViewer.exposure = exp + Math.random() * 0.0001 - 0.00005;
  requestAnimationFrame(() => { modelViewer.exposure = exp; });
}

// ======================== Angle drag ========================
function calcAngle(event) {
  const rect = shaderRound.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  let a = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
  return (a + 90 + 360) % 360;
}

function onAngleDragStart(e) {
  isDragging = true;
  e.preventDefault();
  angle = calcAngle(e);
  applyAngle();
}
function onAngleDragMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  angle = calcAngle(e);
  applyAngle();
}
function onAngleDragEnd() { isDragging = false; shaderRound.style.cursor = 'grab'; }

function applyAngle() {
  shaderRound.style.transform = `rotate(${angle}deg)`;
  shaderRound.style.cursor = isDragging ? 'grabbing' : 'grab';
  angleSphere.style.transform = `rotate(${angle - 90}deg)`;
  updateLightDirection();
}

// ======================== Projection toggle ========================
function toggleProjection(type) {
  projectionMode = type;
  document.querySelectorAll('[data-projection]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.projection === type);
  });
  if (type === 'orthographic') {
    changeGroundGrid('remove');
    modelViewer.exposure = modelViewer.exposure - 0.1;
    modelViewer.exposure = modelViewer.exposure + 0.1;
  } else {
    changeGroundGrid('add');
    modelViewer.exposure = modelViewer.exposure + 0.1;
    modelViewer.exposure = modelViewer.exposure - 0.1;
  }
  const cam = createCamera(type);
  replaceModelViewerCamera(cam, type);
}

// ======================== Preset views ========================
function setPresetView(view) {
  presetView = view;
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === view);
  });
  const orbit = modelViewer.getCameraOrbit();
  if (modelViewer.resetTurntableRotation) modelViewer.resetTurntableRotation();
  const r = orbit.radius.toFixed(2);
  const map = { front: `0deg 90deg ${r}m`, back: `180deg 90deg ${r}m`, side: `90deg 90deg ${r}m`, top: `180deg 0deg ${r}m` };
  if (map[view]) modelViewer.cameraOrbit = map[view];
}

// ======================== Model init ========================
async function initModelViewerAfterLoad() {
  modelViewer.autoRotate = false;
  scale = calculateScale();
  initCamera();
  addGroundGrid();
  getTriangleCount();
  await getModelMaterials();
  setTimeout(() => {
    addDirectionalLight();
    addAmbientLight();
    updateAmbientLightIntensity();
  }, 200);
}

async function getModelMaterials() {
  try {
    const result = await GLBMaterialExtractor.extractMaterialsFromModelViewer(modelViewer);
    if (result.thumbnailsList.length > 0) {
      modelViewer.exposure = 1;
      isWhiteModel = false;
      currentTexture = '贴图';
    } else {
      isWhiteModel = true;
      modelViewer.exposure = 0.3;
      currentTexture = '白膜';
      showWhiteModel();
    }
    refreshTextureButtons();
  } catch (e) { console.error('提取材质失败:', e); }
}

// ======================== Upload ========================
function handleFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  handleModelFile(file);
}

function handleModelFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    showToast('仅支持 GLB 格式');
    fileInput.value = '';
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    showToast('文件大小不能超过 100MB');
    fileInput.value = '';
    return;
  }
  loadModelFile(file);
}

async function loadModelFile(file) {
  if (isUploading) return;
  isUploading = true;
  uploadLabel.textContent = '上传中...';
  uploadBtn.classList.add('disabled');

  resetPage();
  setEmptyStateVisible(false);

  currentFileName = file.name;
  const fp = fileFingerprint(file);

  const cached = await getModelFromCache(fp);
  if (cached) {
    currentModelBlob = cached;
  } else {
    currentModelBlob = file;
    await saveModelToCache(fp, file);
  }

  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(currentModelBlob);
  modelViewer.src = blobUrl;

  isUploading = false;
  uploadLabel.textContent = '上传';
  uploadBtn.classList.remove('disabled');
  fileInput.value = '';
}

// ======================== Progress ========================
modelViewer.addEventListener('progress', (e) => {
  currentProgress = e.detail.totalProgress * 100;
  progressText.textContent = `${currentProgress.toFixed(0)}%`;

  if (currentProgress > 0 && currentProgress < 100) {
    loadingEl.classList.remove('hidden');
    modelViewer.style.opacity = '0';
    setEmptyStateVisible(false);
  } else if (currentProgress >= 100) {
    loadingEl.classList.add('hidden');
    modelViewer.style.opacity = '1';
    setEmptyStateVisible(false);
  }
});

modelViewer.addEventListener('load', async () => {
  loadingEl.classList.add('hidden');
  modelViewer.style.opacity = '1';
  currentProgress = 100;
  setEmptyStateVisible(false);
  enablePanels();
  await initModelViewerAfterLoad();
});

modelViewer.addEventListener('error', () => {
  showToast('模型加载失败，请重试');
  loadingEl.classList.add('hidden');
  setEmptyStateVisible(true);
});

modelViewer.addEventListener('camera-change', (e) => {
  if (e.detail.source === 'user-interaction') {
    presetView = 'none';
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.remove('is-active'));
  }
});


// ======================== Cleanup ========================
function disposeMaterial(material) {
  ['map','normalMap','emissiveMap','roughnessMap','metalnessMap','aoMap','lightMap','bumpMap','displacementMap','specularMap','envMap','alphaMap'].forEach(k => {
    if (material[k]) material[k].dispose();
  });
  material.dispose();
}

function cleanupResources() {
  const scene = getThreeScene();
  if (scene) {
    if (directionalLight) { scene.remove(directionalLight); directionalLight.dispose(); directionalLight = null; }
    if (ambientLight) { scene.remove(ambientLight); ambientLight.dispose(); ambientLight = null; }
    const rootScene = getRootScene();
    if (rootScene) {
      const grid = rootScene.getObjectByName('groundGrid');
      if (grid) { rootScene.remove(grid); grid.geometry?.dispose(); grid.material?.dispose(); }
    }
    scene.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(disposeMaterial);
          else disposeMaterial(child.material);
        }
      }
    });
  }
  currentModelBlob = null;
  currentTexture = '贴图';
  isWhiteModel = false;
  presetView = 'front';
  projectionMode = 'perspective';
  angle = 0;
  lightIntensity = 2;
  ambientLightIntensityVal = 0;
  currentProgress = 0;
  triangleCountEl.textContent = '-';
}

function resetPage() {
  cleanupResources();
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
  modelViewer.removeAttribute('src');
  modelViewer.style.opacity = '0';
  disablePanels();
  lightSlider.value = 2; lightNumber.value = 2;
  ambientSlider.value = 0; ambientNumber.value = 0;
  shaderRound.style.transform = 'rotate(0deg)';
  angleSphere.style.transform = 'rotate(-90deg)';
  document.querySelectorAll('[data-projection]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.projection === 'perspective'));
  document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.view === 'front'));
  refreshTextureButtons();
  updateRangeTrack(lightSlider);
  updateRangeTrack(ambientSlider);
  setEmptyStateVisible(true);
}

// ======================== Panel enable/disable ========================
function enablePanels() {
  [leftPanel, rightPanel].forEach(p => p.classList.remove('pointer-events-none'));
}
function disablePanels() {
  [leftPanel, rightPanel].forEach(p => p.classList.add('pointer-events-none'));
}

function setEmptyStateVisible(visible) {
  if (!emptyState) return;
  emptyState.classList.toggle('hidden', !visible);
}

// ======================== Toast ========================
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;top:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 24px;border-radius:8px;font-size:14px;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

function formatTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${MM}${dd}_${hh}${mm}${ss}`;
}

function getBaseName(name) {
  if (!name) return 'model';
  return name.replace(/\.[^/.]+$/, '') || 'model';
}

function getScreenshotDataUrl() {
  try {
    if (typeof modelViewer.toDataURL === 'function') {
      return modelViewer.toDataURL('image/png');
    }
  } catch (e) {
    console.warn('model-viewer 截图失败，尝试 canvas 兜底:', e);
  }

  try {
    const renderer = modelViewer.renderer;
    const canvas = renderer?.threeRenderer?.domElement || renderer?.canvas;
    if (!canvas || typeof canvas.toDataURL !== 'function') return '';
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('canvas 截图失败:', e);
    return '';
  }
}

function getGroundGrid() {
  const rootScene = getRootScene();
  if (!rootScene) return null;
  return rootScene.getObjectByName('groundGrid');
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function handleScreenshotDownload() {
  if (!modelViewer?.src || currentProgress < 100) {
    showToast('请先上传并加载完成模型');
    return;
  }

  const grid = getGroundGrid();
  const prevGridVisible = grid ? grid.visible : null;
  let dataUrl = '';
  try {
    if (grid) {
      grid.visible = false;
      nudgeExposure();
      await nextFrame();
    }
    dataUrl = getScreenshotDataUrl();
  } finally {
    if (grid && prevGridVisible !== null) {
      grid.visible = prevGridVisible;
      nudgeExposure();
    }
  }

  if (!dataUrl) {
    showToast('截图失败，请重试');
    return;
  }

  const filename = `${getBaseName(currentFileName)}_screenshot_${formatTimestamp()}.png`;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ======================== Event bindings ========================
fileInput.addEventListener('change', handleFileSelect);
if (screenshotBtn) {
  screenshotBtn.addEventListener('click', handleScreenshotDownload);
}
document.querySelectorAll('[data-projection]').forEach(btn => {
  btn.addEventListener('click', () => toggleProjection(btn.dataset.projection));
});
document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setPresetView(btn.dataset.view));
});
document.querySelectorAll('#textureBar .texture-icon-container').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.texture;
    if (t === '贴图') restoreOriginalMaterial();
    else if (t === '白膜') showWhiteModel();
    else if (t === '法线') switchToNormalMapDisplay();
    else if (t === '反照') switchToAlbedoMap();
  });
});

// Slider sync
function syncSlider(slider, number, setter) {
  slider.addEventListener('input', () => { number.value = slider.value; setter(parseFloat(slider.value)); });
  number.addEventListener('input', () => { slider.value = number.value; setter(parseFloat(number.value)); });
}
syncSlider(lightSlider, lightNumber, (v) => { lightIntensity = v; updateLightIntensityVal(); });
syncSlider(ambientSlider, ambientNumber, (v) => { ambientLightIntensityVal = v; updateAmbientLightIntensity(); });

// Angle drag
shaderRound.addEventListener('mousedown', onAngleDragStart);
shaderRound.addEventListener('touchstart', onAngleDragStart, { passive: false });
document.addEventListener('mousemove', onAngleDragMove);
document.addEventListener('mouseup', onAngleDragEnd);
document.addEventListener('touchmove', onAngleDragMove, { passive: false });
document.addEventListener('touchend', onAngleDragEnd);

// Range track coloring
function updateRangeTrack(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.background = `linear-gradient(to right, #745ef5 0%, #745ef5 ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`;
}
[lightSlider, ambientSlider].forEach(s => {
  s.addEventListener('input', () => updateRangeTrack(s));
  updateRangeTrack(s);
});

if (emptyDropzone) {
  emptyDropzone.addEventListener('click', () => fileInput.click());
  emptyDropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  emptyDropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    emptyDropzone.classList.add('is-dragover');
  });
  emptyDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    emptyDropzone.classList.add('is-dragover');
  });
  emptyDropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    emptyDropzone.classList.remove('is-dragover');
  });
  emptyDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    emptyDropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    handleModelFile(file);
  });
}

if (app) {
  app.addEventListener('dragover', (e) => e.preventDefault());
  app.addEventListener('drop', (e) => e.preventDefault());
}

setEmptyStateVisible(true);

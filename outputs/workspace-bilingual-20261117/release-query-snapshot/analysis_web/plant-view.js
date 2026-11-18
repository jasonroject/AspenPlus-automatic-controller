/* Interactive illustrative equipment scene; dimensions are not process design inputs. */
(() => {
  const english = document.documentElement.lang === "en";
  let renderer,
    scene,
    camera,
    host,
    mounted = false;
  let theta = 0.5,
    phi = 0.98,
    distance = 33,
    selected = "reactor",
    focused = false,
    cameraMode = "overview";
  const target = new THREE.Vector3(0, 1, 0);
  let heatLoop, bypass, exchangerInlet, selectionFrame;
  const units = {},
    pickable = [],
    labels = [],
    selectedMaterials = new Map();
  const englishNames = {
    feed: "Feed",
    pump: "High-pressure pump",
    exchanger: "Heat recovery",
    heater: "Electric heater",
    reactor: "Tubular reactor",
    cooler: "Cooler",
    separator: "Phase separator",
  };
  const locations = {
    feed: [-8, 0, 3.4, "进料", 3.1],
    pump: [-5, 0, 3.4, "高压泵", 2.1],
    exchanger: [-1.5, 0, 3.4, "热回收", 2.3],
    heater: [3, 0, 3.4, "电加热", 3.2],
    reactor: [6.5, 0, -1.8, "管式反应器", 3.8],
    cooler: [0.8, 0, -3.2, "冷却器", 2.1],
    separator: [-5.2, 0, -3.2, "相分离器", 3.9],
  };
  function createUnit(id) {
    const [x, y, z, name, height] = locations[id];
    const group = window.HTLEquipment.build(id);
    group.position.set(x, y, z);
    scene.add(group);
    units[id] = group;
    group.traverse((o) => {
      if (o.isMesh) {
        o.userData.equipment = id;
        o.userData.baseMaterial = o.material;
        pickable.push(o);
      }
    });
    const element = document.createElement("button");
    element.className = "equipment-label";
    const label = english ? englishNames[id] : name;
    element.textContent = label;
    element.dataset.equipment = id;
    if (english) element.title = label;
    element.setAttribute("aria-label", english ? `View ${label.toLowerCase()} parameters` : `查看${name}参数`);
    document.getElementById("plant-labels").append(element);
    labels.push({ element, label, number: String(labels.length + 1).padStart(2, "0"), point: new THREE.Vector3(x, height, z) });
  }
  function layoutEnglishLabels(w, h) {
    const placed = [];
    const gap = 6;
    // Keep the current device readable; compact labels match the numbered navigation.
    const visible = labels.filter(({ element }) => !element.hidden).sort(
      (a, b) => Number(b.element.dataset.equipment === selected) - Number(a.element.dataset.equipment === selected),
    );
    visible.forEach(({ element, label, number }) => {
      const active = element.dataset.equipment === selected;
      element.textContent = w < 680 && !active ? number : label;
      const anchorX = parseFloat(element.style.left);
      const anchorY = parseFloat(element.style.top);
      const rectangle = (y) => {
        const width = element.offsetWidth, height = element.offsetHeight;
        const x = Math.max(width / 2 + gap, Math.min(w - width / 2 - gap, anchorX));
        return { x, y, left: x - width / 2, right: x + width / 2, top: y - height, bottom: y };
      };
      const overlaps = (box) => placed.some((other) =>
        box.left < other.right + gap && box.right + gap > other.left &&
        box.top < other.bottom + gap && box.bottom + gap > other.top,
      );
      let box = rectangle(anchorY);
      if (!active && overlaps(box)) {
        element.textContent = number;
        box = rectangle(anchorY);
      }
      // Rotated views can project two devices to the same spot, even as numbers.
      const step = element.offsetHeight + gap;
      for (let offset = 1; overlaps(box) && offset <= visible.length * 2; offset++) {
        const direction = offset % 2 ? -1 : 1;
        const y = anchorY + direction * Math.ceil(offset / 2) * step;
        const candidate = rectangle(y);
        if (candidate.top >= gap && candidate.bottom <= h - gap && !overlaps(candidate)) box = candidate;
      }
      element.style.left = `${box.x}px`;
      element.style.top = `${box.y}px`;
      placed.push(box);
    });
  }
  function draw() {
    if (
      !renderer ||
      !scene ||
      !camera ||
      !host?.clientWidth ||
      !host.clientHeight
    )
      return;
    const w = host.clientWidth,
      h = host.clientHeight;
    if (
      renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) ||
      renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())
    )
      renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const r = distance * (w / h < 1.2 ? 1.2 / camera.aspect : 1);
    camera.position.set(
      target.x + r * Math.sin(phi) * Math.sin(theta),
      target.y + r * Math.cos(phi),
      target.z + r * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
    if (heatLoop) heatLoop.visible = host.dataset.scenario === "HR" && !focused;
    renderer.render(scene, camera);
    labels.forEach(({ element, point }) => {
      const p = point.clone().project(camera);
      element.style.left = `${((p.x + 1) * w) / 2}px`;
      element.style.top = `${((1 - p.y) * h) / 2}px`;
      element.hidden =
        (focused && element.dataset.equipment !== selected) ||
        Math.abs(p.x) > 0.95 ||
        Math.abs(p.y) > 0.95 ||
        p.z > 1;
    });
    if (english) layoutEnglishLabels(w, h);
  }
  function setCameraMode(mode) {
    cameraMode = mode;
    if (!host) return;
    host.dataset.camera = mode;
    document.querySelectorAll("button[data-camera]").forEach((button) => {
      const preset = button.dataset.camera;
      if (!["iso", "top", "focus"].includes(preset)) return;
      const active = (preset === "iso" ? "overview" : preset) === mode;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    });
  }
  function frameSelected() {
    if (!units[selected]) return;
    const position = units[selected].position;
    const height = locations[selected][4];
    target.set(position.x, height / 2, position.z);
    distance = Math.max(9, height * 3.3);
  }
  function focusSelected() {
    if (!mounted || !units[selected]) return;
    focused = true;
    phi = 1.1;
    theta = 0.65;
    frameSelected();
    setCameraMode("focus");
  }
  function resetOverview() {
    theta = 0.5;
    phi = 0.98;
    distance = 33;
    focused = false;
    target.set(0, 1, 0);
    setCameraMode("overview");
  }
  function zoom(factor) {
    distance = Math.max(focused ? 4 : 20, Math.min(55, distance * factor));
    setCameraMode(focused ? "focus" : "custom");
  }
  function equipmentAt(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      ),
      camera,
    );
    return ray.intersectObjects(pickable)[0]?.object.userData.equipment;
  }
  function announceSelection(id) {
    if (!id) return;
    document.dispatchEvent(new CustomEvent("htl-equipment", { detail: id }));
  }
  function highlightUnit(id, active) {
    units[id]?.traverse((part) => {
      if (!part.isMesh) return;
      const base = part.userData.baseMaterial;
      const highlight = (material) => {
        if (!selectedMaterials.has(material)) {
          const copy = material.clone();
          // Keep the original materials intact: several devices share them.
          copy.color?.set(0x424242);
          copy.emissive?.set(0x000000);
          if ("metalness" in copy) copy.metalness = 0.18;
          if ("roughness" in copy) copy.roughness = 0.48;
          selectedMaterials.set(material, copy);
        }
        return selectedMaterials.get(material);
      };
      part.material = active
        ? (Array.isArray(base) ? base.map(highlight) : highlight(base))
        : base;
    });
  }
  function select(id) {
    if (!locations[id]) return;
    const previous = selected;
    const changed = selected !== id;
    selected = id;
    if (!mounted) return;
    if (changed || host.dataset.selectedEquipment !== id) {
      highlightUnit(previous, false);
      highlightUnit(id, true);
      selectionFrame.box.setFromObject(units[id]).expandByScalar(0.12);
      host.dataset.selectedEquipment = id;
    }
    if (focused && changed) frameSelected();
    labels.forEach(({ element }) => {
      const active = element.dataset.equipment === id;
      element.classList.toggle("active", active);
      element.setAttribute("aria-pressed", String(active));
    });
    draw();
  }
  function setScenario(value) {
    if (!mounted) return;
    host.dataset.scenario = value;
    heatLoop.visible = value === "HR";
    bypass.visible = value !== "HR";
    exchangerInlet.visible = value === "HR";
    draw();
  }
  function mount() {
    if (mounted) {
      draw();
      return;
    }
    host = document.getElementById("plant-scene");
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0xe7eef4);
      host.append(renderer.domElement);
      renderer.domElement.setAttribute(
        "aria-label",
        english
          ? "Illustrative 3D HTL equipment. The selected unit is shaded dark and outlined. Drag to rotate; double-click a unit to focus. Ctrl or Command plus scroll to zoom. Arrow keys rotate, plus and minus zoom, 0 restores the overview, and Escape exits focus."
          : "水热液化设备三维示意。当前选中设备以深色与外框高亮。拖动旋转，双击设备聚焦；Ctrl 或 Command 加滚轮缩放。键盘方向键旋转，加减键缩放，0 恢复全景，Escape 退出聚焦。",
      );
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-keyshortcuts",
        "ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 Escape",
      );
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(28, 1, 0.1, 180);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      const mats = window.HTLEquipment.setup(renderer, scene);
      scene.add(new THREE.HemisphereLight(0xf0f5fc, 0x63717e, 0.5));
      const sun = new THREE.DirectionalLight(0xfff6e5, 2);
      sun.position.set(-6, 14, 7);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, {
        left: -15,
        right: 15,
        top: 12,
        bottom: -12,
      });
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.025;
      sun.shadow.radius = 3;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xe4edff, 0.6);
      fill.position.set(10, 6, -9);
      scene.add(fill);
      window.HTLEquipment.site(scene);
      Object.keys(locations).forEach(createUnit);
      const pipe = (points, material = mats.pipe, r = 0.045) =>
        window.HTLEquipment.pipe(scene, points, material, r);
      pipe([
        [-7.2, 0.88, 3.4],
        [-6.7, 0.88, 3.4],
        [-6.7, 0.8, 3.4],
        [-6.45, 0.8, 3.4],
      ]);
      pipe([
        [-6.02, 1.5, 3.4],
        [-6.02, 1.8, 3.4],
        [-3.5, 1.8, 3.4],
        [-3.5, 1.04, 3.4],
      ]);
      exchangerInlet = pipe([
        [-3.5, 1.04, 3.4],
        [-3.375, 1.04, 3.4],
      ]);
      pipe([
        [0.375, 1.04, 3.4],
        [1.6, 1.04, 3.4],
        [1.6, 0.9, 3.4],
        [2.43, 0.9, 3.4],
      ]);
      pipe([
        [3.57, 2.08, 3.4],
        [4.3, 2.08, 3.4],
        [4.3, 2.08, -1.8],
        [4.3, 0.65, -1.8],
        [5.2, 0.65, -1.8],
      ]);
      pipe([
        [5.2, 2.75, -1.8],
        [4.5, 2.75, -1.8],
        [4.5, 2.75, -3.2],
        [4.5, 1.04, -3.2],
        [2.425, 1.04, -3.2],
      ]);
      pipe([
        [-0.825, 1.04, -3.2],
        [-3.8, 1.04, -3.2],
        [-3.8, 1.9, -3.2],
        [-4.31, 1.9, -3.2],
      ]);
      window.HTLEquipment.valve(scene, [1.9, 0.9, 3.4]);
      window.HTLEquipment.valve(scene, [-3.1, 1.04, -3.2]);
      bypass = pipe([
        [-3.5, 1.04, 3.4],
        [-3.5, 1.04, 4.6],
        [-3.5, 0.4, 4.6],
        [0.5, 0.4, 4.6],
        [0.5, 0.4, 3.4],
        [0.5, 1.04, 3.4],
      ]);
      // Dashed amber connector represents heat integration, not a material pipe.
      const energyPoints = [
        [5.2, 2.75, -1.8],
        [5.2, 4.2, -1.8],
        [-2.3, 4.2, -1.8],
        [-2.3, 4.2, 3.4],
        [-2.3, 1.68, 3.4],
      ].map((p) => new THREE.Vector3(...p));
      heatLoop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(energyPoints),
        new THREE.LineDashedMaterial({
          color: 0xba9146,
          dashSize: 0.15,
          gapSize: 0.11,
          transparent: true,
          opacity: 0.85,
        }),
      );
      heatLoop.computeLineDistances();
      scene.add(heatLoop);
      selectionFrame = new THREE.Box3Helper(new THREE.Box3(), 0x222222);
      selectionFrame.material.depthTest = false;
      selectionFrame.material.depthWrite = false;
      selectionFrame.renderOrder = 10;
      scene.add(selectionFrame);
      mounted = true;
      setCameraMode(cameraMode);
      select(selected);
      setScenario("STD");
      new ResizeObserver(draw).observe(host);
      const canvas = renderer.domElement;
      let drag;
      canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        canvas.focus({ preventScroll: true });
        drag = {
          x: e.clientX,
          y: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
        };
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4)
          drag.moved = true;
        if (drag.moved) {
          theta -= (e.clientX - drag.lastX) * 0.007;
          phi = Math.max(
            0.08,
            Math.min(1.35, phi + (e.clientY - drag.lastY) * 0.006),
          );
          setCameraMode(focused ? "focus" : "custom");
          draw();
        }
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      });
      canvas.addEventListener("pointerup", (e) => {
        if (!drag) return;
        if (!drag.moved) {
          announceSelection(equipmentAt(e));
        }
        drag = null;
        canvas.releasePointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointercancel", () => {
        drag = null;
      });
      canvas.addEventListener("dblclick", (e) => {
        const id = equipmentAt(e);
        if (!id) return;
        select(id);
        announceSelection(id);
        focusSelected();
        draw();
      });
      canvas.addEventListener(
        "wheel",
        (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          zoom(Math.exp(e.deltaY * 0.001));
          draw();
        },
        { passive: false },
      );
      canvas.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "0") resetOverview();
        else if (e.key === "Escape" && focused) resetOverview();
        else if (e.key === "+" || e.key === "=") zoom(0.85);
        else if (e.key === "-" || e.key === "_") zoom(1 / 0.85);
        else if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        ) {
          if (e.key === "ArrowLeft") theta += 0.1;
          if (e.key === "ArrowRight") theta -= 0.1;
          if (e.key === "ArrowUp") phi = Math.max(0.08, phi - 0.08);
          if (e.key === "ArrowDown") phi = Math.min(1.35, phi + 0.08);
          setCameraMode(focused ? "focus" : "custom");
        } else return;
        e.preventDefault();
        draw();
      });
      document.querySelectorAll("button[data-camera]").forEach((button) =>
        button.addEventListener("click", () => {
          const mode = button.dataset.camera;
          if (mode === "iso") {
            resetOverview();
          }
          if (mode === "top") {
            theta = 0;
            phi = 0.08;
            distance = 33;
            focused = false;
            target.set(0, 1, 0);
            setCameraMode("top");
          }
          if (mode === "focus") {
            focusSelected();
          }
          if (mode === "zoom-in") zoom(0.85);
          if (mode === "zoom-out") zoom(1 / 0.85);
          draw();
        }),
      );
    } catch (error) {
      document.getElementById("plant-fallback").hidden = false;
      document
        .querySelectorAll("button[data-camera]")
        .forEach((button) => (button.disabled = true));
      console.error("Plant scene unavailable", error);
    }
  }
  window.htlPlant = { mount, select, setScenario, resize: draw };
})();

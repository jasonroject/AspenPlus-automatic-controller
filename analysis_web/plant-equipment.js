/* Illustrative mechanical assemblies. These are not fabrication drawings. */
(() => {
  const T = THREE,
    Y = new T.Vector3(0, 1, 0);
  let m;
  function solid(parent, geometry, material, position = [0, 0, 0]) {
    const part = new T.Mesh(geometry, material);
    part.position.set(...position);
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  }
  function box(g, size, p, mat = m.frame) {
    return solid(g, new T.BoxGeometry(...size), mat, p);
  }
  function cyl(
    g,
    r,
    length,
    p,
    axis = [0, 1, 0],
    mat = m.steel,
    segments = 40,
  ) {
    const part = solid(
      g,
      new T.CylinderGeometry(r, r, length, segments),
      mat,
      p,
    );
    part.quaternion.setFromUnitVectors(Y, new T.Vector3(...axis).normalize());
    return part;
  }
  function beam(g, start, end, width = 0.06, depth = 0.06, mat = m.frame) {
    const a = new T.Vector3(...start),
      b = new T.Vector3(...end),
      delta = b.clone().sub(a);
    const part = box(
      g,
      [width, delta.length(), depth],
      a.clone().add(b).multiplyScalar(0.5).toArray(),
      mat,
    );
    part.quaternion.setFromUnitVectors(Y, delta.normalize());
    return part;
  }
  function flange(g, radius, p, axis = [1, 0, 0], count = 12) {
    const f = new T.Group();
    g.add(f);
    f.position.set(...p);
    f.quaternion.setFromUnitVectors(Y, new T.Vector3(...axis));
    cyl(f, radius, 0.045, [0, -0.032, 0], [0, 1, 0], m.machined);
    cyl(f, radius, 0.045, [0, 0.032, 0], [0, 1, 0], m.machined);
    cyl(f, radius * 0.97, 0.014, [0, 0, 0], [0, 1, 0], m.gasket);
    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count;
      cyl(
        f,
        Math.min(0.033, radius * 0.085),
        0.15,
        [radius * 0.84 * Math.cos(a), 0, radius * 0.84 * Math.sin(a)],
        [0, 1, 0],
        m.bolt,
        6,
      );
    }
    return f;
  }
  function nozzle(g, p, axis, radius = 0.075, length = 0.28) {
    const center = p.map((v, i) => v + (axis[i] * length) / 2),
      end = p.map((v, i) => v + axis[i] * length);
    cyl(g, radius, length, center, axis);
    cyl(g, radius * 1.5, 0.035, p, axis, m.machined);
    flange(g, radius * 1.8, end, axis, 8);
    return end;
  }
  function head(g, r, p, axis) {
    const part = solid(
      g,
      new T.SphereGeometry(r, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      m.steel,
      p,
    );
    part.scale.y = 0.48;
    part.quaternion.setFromUnitVectors(Y, new T.Vector3(...axis));
  }
  function pipe(g, points, mat = m.pipe, radius = 0.045) {
    const v = points
      .filter(
        (p, i) => !i || p.some((n, j) => Math.abs(n - points[i - 1][j]) > 1e-6),
      )
      .map((p) => new T.Vector3(...p));
    const path = new T.CurvePath();
    let start = v[0];
    for (let i = 1; i < v.length - 1; i++) {
      const a = v[i - 1],
        b = v[i],
        c = v[i + 1];
      const r = Math.min(
        radius * 4.5,
        b.distanceTo(a) * 0.35,
        b.distanceTo(c) * 0.35,
      );
      const entry = b
        .clone()
        .add(a.clone().sub(b).normalize().multiplyScalar(r));
      const exit = b
        .clone()
        .add(c.clone().sub(b).normalize().multiplyScalar(r));
      path.add(new T.LineCurve3(start, entry));
      path.add(new T.QuadraticBezierCurve3(entry, b, exit));
      start = exit;
    }
    path.add(new T.LineCurve3(start, v[v.length - 1]));
    return solid(
      g,
      new T.TubeGeometry(
        path,
        Math.max(24, points.length * 14),
        radius,
        12,
        false,
      ),
      mat,
    );
  }
  function gauge(g, p) {
    pipe(g, [[p[0], p[1] - 0.28, p[2]], [...p]], m.machined, 0.025);
    cyl(g, 0.12, 0.065, p, [0, 0, 1], m.machined);
    cyl(g, 0.097, 0.005, [p[0], p[1], p[2] + 0.035], [0, 0, 1], m.white);
    beam(
      g,
      [p[0], p[1], p[2] + 0.04],
      [p[0] - 0.045, p[1] + 0.06, p[2] + 0.04],
      0.008,
      0.008,
      m.gasket,
    );
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 1.5 - Math.PI * 0.25;
      beam(
        g,
        [p[0] + 0.07 * Math.cos(a), p[1] + 0.07 * Math.sin(a), p[2] + 0.04],
        [p[0] + 0.085 * Math.cos(a), p[1] + 0.085 * Math.sin(a), p[2] + 0.04],
        0.006,
        0.006,
        m.gasket,
      );
    }
  }
  function valve(g, p, axis = [1, 0, 0]) {
    cyl(g, 0.095, 0.22, p, axis, m.machined);
    [-0.17, 0.17].forEach((d) =>
      flange(
        g,
        0.12,
        p.map((v, i) => v + axis[i] * d),
        axis,
        6,
      ),
    );
    cyl(g, 0.018, 0.25, [p[0], p[1] + 0.16, p[2]], [0, 1, 0], m.machined);
    const wheel = solid(g, new T.TorusGeometry(0.115, 0.014, 8, 28), m.handle, [
      p[0],
      p[1] + 0.3,
      p[2],
    ]);
    wheel.rotation.x = Math.PI / 2;
    beam(
      g,
      [p[0] - 0.11, p[1] + 0.3, p[2]],
      [p[0] + 0.11, p[1] + 0.3, p[2]],
      0.015,
      0.015,
      m.handle,
    );
  }
  function plate(g, p, w = 0.25, h = 0.12) {
    box(g, [w, h, 0.012], p, m.nameplate);
    [-1, 1].forEach((x) =>
      [-1, 1].forEach((y) =>
        cyl(
          g,
          0.012,
          0.02,
          [p[0] + x * w * 0.4, p[1] + y * h * 0.35, p[2] + 0.01],
          [0, 0, 1],
          m.bolt,
          6,
        ),
      ),
    );
  }
  function anchor(g, x, z) {
    box(g, [0.24, 0.035, 0.24], [x, 0.1, z], m.machined);
    [-0.07, 0.07].forEach((dx) =>
      [-0.07, 0.07].forEach((dz) =>
        cyl(g, 0.023, 0.07, [x + dx, 0.15, z + dz], [0, 1, 0], m.bolt, 6),
      ),
    );
  }
  function saddle(g, x, r, cy) {
    box(g, [0.27, 0.06, r * 2.5], [x, 0.15, 0]);
    const shape = new T.Shape();
    const w = r * 1.07,
      bottom = 0.19;
    shape.moveTo(-w, bottom);
    shape.lineTo(w, bottom);
    shape.lineTo(w, cy - 0.12);
    // A concave web follows the lower shell, with a genuine cradle silhouette.
    for (let i = 0; i <= 20; i++) {
      const z = w - (i * w * 2) / 20;
      shape.lineTo(
        z,
        cy - Math.sqrt(Math.max(0, r * r - Math.min(r * r, z * z))),
      );
    }
    shape.lineTo(-w, bottom);
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, {
      depth: 0.12,
      bevelEnabled: false,
    });
    geo.rotateY(Math.PI / 2);
    geo.translate(x - 0.06, 0, 0);
    solid(g, geo, m.frame);
    [-0.18, 0.18].forEach((z) =>
      beam(g, [x, 0.2, z], [x + 0.15, cy - r * 0.7, z], 0.035, 0.04),
    );
    [-1, 1].forEach((sign) =>
      cyl(g, 0.025, 0.09, [x, 0.21, sign * r * 1.05], [0, 1, 0], m.bolt, 6),
    );
  }
  function exchanger(g, compact = false) {
    const r = compact ? 0.3 : 0.37,
      L = compact ? 2.15 : 2.65,
      cy = 1.04;
    cyl(g, r, L, [0, cy, 0], [1, 0, 0]);
    [-1, 1].forEach((sign) => {
      flange(g, r * 1.24, [(sign * L) / 2, cy, 0]);
      cyl(g, r, 0.24, [sign * (L / 2 + 0.17), cy, 0], [1, 0, 0]);
      head(g, r, [sign * (L / 2 + 0.29), cy, 0], [sign, 0, 0]);
      nozzle(g, [sign * (L / 2 + 0.3), cy, 0], [sign, 0, 0], 0.07, 0.25);
    });
    [-L * 0.31, L * 0.31].forEach((x) => saddle(g, x, r, cy));
    [-L * 0.29, L * 0.29].forEach((x, i) => {
      nozzle(g, [x, cy + r - 0.01, 0], [0, 1, 0], 0.065, 0.27);
      cyl(g, r + 0.005, 0.04, [x, cy, 0], [1, 0, 0], m.machined);
      if (compact)
        cyl(g, 0.071, 0.08, [x, cy + r + 0.13, 0], [0, 1, 0], m.coolant);
    });
    plate(g, [0, cy, r + 0.012]);
    gauge(g, [L * 0.25, cy + r + 0.4, 0.1]);
  }
  function vessel(g, separator = false) {
    const r = separator ? 0.61 : 0.52,
      h = separator ? 2.35 : 1.5,
      bottom = 0.7;
    cyl(g, r, h, [0, bottom + h / 2, 0]);
    head(g, r, [0, bottom, 0], [0, -1, 0]);
    head(g, r, [0, bottom + h, 0], [0, 1, 0]);
    [bottom + 0.08, bottom + h - 0.08].forEach((y) =>
      cyl(g, r + 0.004, 0.025, [0, y, 0], [0, 1, 0], m.machined),
    );
    if (separator) {
      cyl(g, r * 0.81, 0.6, [0, 0.38, 0], [0, 1, 0], m.frame);
      flange(g, r * 0.95, [0, 0.14, 0], [0, 1, 0]);
      nozzle(g, [0, 1.75, r], [0, 0, 1], 0.19, 0.13);
      // Separate ladder and access rails establish scale without adding process units.
      [-0.2, 0.2].forEach((x) =>
        beam(g, [x, 0.2, -r - 0.22], [x, 3.2, -r - 0.22], 0.032, 0.032),
      );
      for (let y = 0.3; y < 3.15; y += 0.22)
        beam(
          g,
          [-0.2, y, -r - 0.22],
          [0.2, y, -r - 0.22],
          0.025,
          0.025,
          m.machined,
        );
      const platform = solid(
        g,
        new T.RingGeometry(r + 0.03, r + 0.38, 48),
        m.deck,
        [0, 2.55, 0],
      );
      platform.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 9; i++) {
        const a = (i * Math.PI * 2) / 9;
        beam(
          g,
          [(r + 0.32) * Math.cos(a), 2.55, (r + 0.32) * Math.sin(a)],
          [(r + 0.32) * Math.cos(a), 3.08, (r + 0.32) * Math.sin(a)],
          0.023,
          0.023,
          m.machined,
        );
      }
      [2.83, 3.08].forEach((y) => {
        const rail = solid(
          g,
          new T.TorusGeometry(r + 0.32, 0.014, 6, 48),
          m.machined,
          [0, y, 0],
        );
        rail.rotation.x = Math.PI / 2;
      });
    } else {
      for (const x of [-0.36, 0.36])
        for (const z of [-0.36, 0.36]) {
          beam(g, [x, 0.12, z], [x, 0.85, z], 0.065, 0.07);
          anchor(g, x, z);
        }
      flange(g, 0.28, [0, bottom + h + 0.22, 0], [0, 1, 0]);
      nozzle(g, [-0.3, bottom + h, 0.1], [0, 1, 0], 0.05, 0.4);
    }
    nozzle(g, [r, separator ? 1.9 : 0.88, 0], [1, 0, 0]);
    nozzle(g, [0, bottom + h + r * 0.48, 0], [0, 1, 0], 0.06, 0.25);
    const levelX = r + 0.12;
    pipe(
      g,
      [
        [levelX - 0.16, 0.95, 0.12],
        [levelX, 0.95, 0.12],
        [levelX, bottom + h - 0.3, 0.12],
        [levelX - 0.16, bottom + h - 0.3, 0.12],
      ],
      m.machined,
      0.025,
    );
    for (let y = 1.05; y < bottom + h - 0.3; y += 0.12)
      box(g, [0.035, 0.04, 0.035], [levelX + 0.04, y, 0.12], m.nameplate);
    plate(g, [0, 1.45, r + 0.01], 0.28, 0.14);
  }
  function pump(g) {
    box(g, [2.45, 0.13, 1.05], [0, 0.22, 0]);
    [-0.95, 0.95].forEach((x) => [-0.4, 0.4].forEach((z) => anchor(g, x, z)));
    cyl(g, 0.29, 0.95, [0.5, 0.72, 0], [1, 0, 0], m.motor);
    for (let i = 0; i < 14; i++) {
      const a = (i * Math.PI * 2) / 14;
      const fin = box(
        g,
        [0.87, 0.05, 0.075],
        [0.5, 0.72 + 0.28 * Math.cos(a), 0.28 * Math.sin(a)],
        m.motor,
      );
      fin.rotation.x = a;
    }
    cyl(g, 0.305, 0.12, [1.03, 0.72, 0], [1, 0, 0], m.frame);
    box(g, [0.32, 0.22, 0.3], [0.55, 1.09, 0], m.motor);
    [-0.31, 0.31].forEach((z) =>
      box(g, [0.7, 0.08, 0.13], [0.5, 0.36, z], m.motor),
    );
    cyl(g, 0.2, 0.3, [-0.15, 0.72, 0], [1, 0, 0], m.guard);
    box(g, [0.6, 0.59, 0.65], [-0.58, 0.68, 0], m.motor);
    box(g, [0.29, 0.4, 0.68], [-1.02, 0.8, 0], m.machined);
    for (const z of [-0.23, 0, 0.23]) {
      cyl(g, 0.065, 0.27, [-1.24, 0.8, z], [1, 0, 0], m.machined);
      cyl(g, 0.08, 0.2, [-1.02, 1.08, z], [0, 1, 0], m.machined, 6);
    }
    pipe(
      g,
      [
        [-1.02, 1.25, -0.23],
        [-1.02, 1.25, 0.23],
      ],
      m.machined,
      0.045,
    );
    nozzle(g, [-1.25, 0.8, 0], [-1, 0, 0], 0.045, 0.2);
    nozzle(g, [-1.02, 1.25, 0], [0, 1, 0], 0.045, 0.25);
    gauge(g, [-0.68, 1.44, 0.21]);
    plate(g, [-0.57, 0.72, 0.33], 0.33, 0.16);
  }
  function heater(g) {
    cyl(g, 0.29, 1.72, [0, 1.58, 0]);
    head(g, 0.29, [0, 0.72, 0], [0, -1, 0]);
    flange(g, 0.37, [0, 2.45, 0], [0, 1, 0]);
    cyl(g, 0.23, 0.3, [0, 2.67, 0], [0, 1, 0], m.motor);
    for (const y of [0.85, 1.4, 2.05])
      cyl(g, 0.302, 0.025, [0, y, 0], [0, 1, 0], m.machined);
    for (const x of [-0.48, 0.48])
      for (const z of [-0.38, 0.38]) {
        beam(g, [x, 0.12, z], [x, 2.25, z], 0.045, 0.055);
        anchor(g, x, z);
      }
    [0.65, 2.12].forEach((y) => {
      beam(g, [-0.48, y, -0.38], [0.48, y, -0.38], 0.05, 0.045);
      beam(g, [-0.48, y, 0.38], [0.48, y, 0.38], 0.05, 0.045);
    });
    nozzle(g, [-0.29, 0.9, 0], [-1, 0, 0], 0.06, 0.28);
    nozzle(g, [0.29, 2.08, 0], [1, 0, 0], 0.06, 0.28);
    box(g, [0.48, 0.62, 0.2], [0.68, 1.4, 0], m.panel);
    plate(g, [0.68, 1.55, 0.11], 0.28, 0.13);
    pipe(
      g,
      [
        [0, 2.82, 0],
        [0.68, 2.82, 0],
        [0.68, 1.7, 0],
      ],
      m.frame,
      0.025,
    );
    gauge(g, [0.37, 2.4, 0.1]);
  }
  function reactor(g) {
    const w = 1.15,
      d = 0.69;
    for (const x of [-w, w])
      for (const z of [-d, d]) {
        beam(g, [x, 0.12, z], [x, 3.25, z], 0.065, 0.065);
        anchor(g, x, z);
      }
    [0.35, 3.2].forEach((y) => {
      beam(g, [-w, y, -d], [w, y, -d], 0.065, 0.08);
      beam(g, [-w, y, d], [w, y, d], 0.065, 0.08);
      [-w, w].forEach((x) => beam(g, [x, y, -d], [x, y, d], 0.065, 0.08));
    });
    beam(g, [-w, 0.4, -d], [w, 3.15, -d], 0.035, 0.035);
    beam(g, [w, 0.4, -d], [-w, 3.15, -d], 0.035, 0.035);
    const points = [];
    for (let i = 0; i < 8; i++) {
      const y = 0.65 + i * 0.3;
      const start = i % 2 ? 0.88 : -0.88,
        end = -start;
      points.push([start, y, 0], [end, y, 0]);
      if (i < 7) points.push([end, y + 0.3, 0]);
    }
    pipe(g, points, m.steel, 0.04);
    [-0.55, 0.55].forEach((x) => {
      beam(g, [x, 0.5, -0.13], [x, 3, -0.13], 0.035, 0.035, m.machined);
      for (let y = 0.65; y < 2.8; y += 0.3) {
        const clip = solid(
          g,
          new T.TorusGeometry(0.055, 0.012, 6, 16),
          m.bolt,
          [x, y, 0],
        );
        clip.rotation.y = Math.PI / 2;
      }
    });
    // A partial guard exposes the tube assembly without inventing a furnace model.
    box(g, [0.025, 2.55, 1.35], [-1.13, 1.7, 0], m.panel);
    for (let y = 0.6; y < 2.9; y += 0.16)
      box(g, [0.03, 0.035, 0.65], [-1.15, y, 0], m.frame);
    nozzle(g, [-0.88, 0.65, 0], [-1, 0, 0], 0.04, 0.42);
    nozzle(g, [-0.88, 2.75, 0], [-1, 0, 0], 0.04, 0.42);
    box(g, [0.5, 0.78, 0.24], [1.45, 1.8, 0], m.panel);
    plate(g, [1.45, 1.99, 0.13], 0.3, 0.17);
    for (const x of [1.33, 1.54])
      cyl(g, 0.028, 0.02, [x, 1.65, 0.14], [0, 0, 1], m.handle);
    beam(g, [1.15, 0.9, 0], [1.45, 0.9, 0], 0.04, 0.04);
    beam(g, [1.45, 0.9, 0], [1.45, 1.4, 0], 0.04, 0.04);
    gauge(g, [-0.55, 3.2, 0.1]);
  }
  function skid(g, x, z, w, d) {
    const group = new T.Group();
    group.position.set(x, 0, z);
    g.add(group);
    box(group, [w, 0.1, d], [0, -0.06, 0], m.deck);
    [-d / 2, d / 2].forEach((z) => {
      box(group, [w, 0.18, 0.045], [0, -0.15, z]);
      [-0.23, -0.06].forEach((y) => box(group, [w, 0.025, 0.17], [0, y, z]));
    });
    for (let px = -w / 2 + 0.2; px < w / 2; px += 1.4) {
      box(group, [0.06, 0.16, d], [px, -0.15, 0]);
      [-d / 2, d / 2].forEach((z) =>
        box(group, [0.4, 0.12, 0.4], [px, -0.29, z], m.concrete),
      );
    }
    for (let px = -w / 2 + 0.1; px < w / 2; px += 0.16)
      box(group, [0.015, 0.007, d - 0.12], [px, -0.005, 0], m.grating);
  }
  function site(g) {
    box(g, [22, 0.12, 13], [0, -0.42, 0], m.concrete);
    skid(g, -2.4, 3.4, 15.1, 2.65);
    skid(g, 0.3, -2.8, 15, 3.6);
    // A narrow common service rack supports the pipes behind the equipment.
    [-7, -3, 1, 5, 8].forEach((x) => {
      [-5.0, -5.8].forEach((z) =>
        beam(g, [x, -0.28, z], [x, 2.25, z], 0.065, 0.065),
      );
      beam(g, [x, 2.25, -5.0], [x, 2.25, -5.8], 0.07, 0.07);
      for (const z of [-5.16, -5.48]) {
        box(g, [0.12, 0.035, 0.16], [x, 2.3025, z], m.machined);
        const clamp = solid(
          g,
          new T.TorusGeometry(0.044, 0.009, 6, 18),
          m.machined,
          [x, 2.35, z],
        );
        clamp.rotation.y = Math.PI / 2;
      }
    });
    [-5.0, -5.8].forEach((z) =>
      beam(g, [-7, 2.25, z], [8, 2.25, z], 0.07, 0.07),
    );
    for (const z of [-5.16, -5.48])
      pipe(
        g,
        [
          [-7, 2.35, z],
          [8, 2.35, z],
        ],
        m.pipe,
        0.035,
      );
    [-7, -3, 1, 5].forEach((x) =>
      beam(g, [x, 0.7, -5.8], [x + 1, 2.2, -5.8], 0.025, 0.025),
    );
  }
  function setup(renderer, scene) {
    const standard = (color, metalness, roughness) =>
      new T.MeshStandardMaterial({ color, metalness, roughness });
    m = {
      steel: standard(0xbcc4cb, 0.85, 0.29),
      machined: standard(0xcbd2da, 0.92, 0.22),
      frame: standard(0x394954, 0.55, 0.52),
      bolt: standard(0x727b85, 0.86, 0.3),
      pipe: standard(0x899da4, 0.8, 0.27),
      motor: standard(0x435e68, 0.45, 0.4),
      panel: standard(0xa3b0ba, 0.62, 0.36),
      gasket: standard(0x252b30, 0.05, 0.8),
      white: standard(0xe5e6df, 0.05, 0.75),
      handle: standard(0xa45d37, 0.3, 0.43),
      coolant: standard(0x466e85, 0.4, 0.4),
      guard: standard(0xb9944f, 0.5, 0.45),
      nameplate: standard(0x344c58, 0.3, 0.5),
      deck: standard(0x6b7880, 0.5, 0.65),
      grating: standard(0x45535e, 0.5, 0.55),
      concrete: standard(0xd2d4d2, 0, 0.95),
    };
    const studio = new T.Scene();
    studio.background = new T.Color(0x69727f);
    const room = solid(
      studio,
      new T.BoxGeometry(40, 30, 40),
      new T.MeshBasicMaterial({ color: 0x7f8996, side: T.BackSide }),
    );
    room.position.y = 6;
    function lightPanel(p, s, brightness) {
      return solid(
        studio,
        new T.BoxGeometry(...s),
        new T.MeshBasicMaterial({
          color: new T.Color(1, 0.98, 0.94).multiplyScalar(brightness),
        }),
        p,
      );
    }
    lightPanel([-10, 8, 4], [0.3, 13, 6], 4);
    lightPanel([9, 7, -6], [0.3, 10, 9], 2.4);
    lightPanel([0, 14, 0], [10, 0.3, 8], 3);
    const pmrem = new T.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(studio, 0.04).texture;
    pmrem.dispose();
    studio.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    return m;
  }
  function build(id) {
    const g = new T.Group();
    if (id === "feed") vessel(g);
    if (id === "separator") vessel(g, true);
    if (id === "pump") pump(g);
    if (id === "exchanger") exchanger(g);
    if (id === "cooler") exchanger(g, true);
    if (id === "heater") heater(g);
    if (id === "reactor") reactor(g);
    return g;
  }
  window.HTLEquipment = { setup, build, pipe, site, valve };
})();

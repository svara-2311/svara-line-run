(() => {
  "use strict";
  var d = document;
  var $ = function (s) { return d.querySelector(s); };
  var cv = d.getElementById("scene");
  var ctx = cv.getContext("2d");
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // palette
  var BG = "#FAF8F3", BLUE = "#3A5A80", PALE = "#9FB3C8", INK = "#141C26", SLATE = "#5A6B7D", ORANGE = "#1663C7";
  var WT = [1.8, 1.1, 0.7]; // heavy silhouette, medium edge, hairline detail

  // ===== projection =====
  // W/H track the browser viewport; cW/cH track the backdrop canvas (same
  // size, kept separate for clarity). VPX/HZ/F/pr are shared by the whole
  // plant layout and its ground grid, so every machine stands on the same
  // floor under one vanishing point.
  var W = 0, H = 0, cW = 0, cH = 0, dpr = 1, mobile = false;
  var VPX = 0, HZ = 0, F = 0;
  var CAMH = 1.5;      // eye level — the Shop Floor card schematics use this
  var PLANT_CAMH = 9; // raised, so the backdrop reads as a plant layout seen from above

  function makeProj(vpx, hz, f, camh) {
    var ch = camh == null ? CAMH : camh;
    return function (x, y, z) {
      var rel = z;
      if (rel < 0.5) return null;
      var s = f / rel;
      return [vpx + x * s, hz + (ch - y) * s, s];
    };
  }
  var pr = makeProj(0, 0, 1); // plant/ground projection, re-parameterised on resize

  // ===== geometry helpers =====
  // a part = { f: [ [polyPts, weight], ... ] far -> near, e: [ extra edges ] }
  // edge = { a, b, w, d(dash) }
  // w: 0 heavy, 1 medium, 2 hairline (the default). `w || 2` would swallow 0.
  function E(a, b, w, dash) { return { a: a, b: b, w: w == null ? 2 : w, d: !!dash }; }
  function P(x, y, z) { return [x, y, z]; }

  // painter's sort for the faces of one (convex) part, in world coords
  function faceEye(pts, dx, dz) {
    var cx = 0, cy = 0, cz = 0;
    for (var i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; cz += pts[i][2]; }
    cx = cx / pts.length + dx; cy /= pts.length; cz = cz / pts.length + dz;
    return cx * cx + (cy - CAMH) * (cy - CAMH) + cz * cz;
  }
  function paintSort(faces, dx, dz) {
    return faces.slice().sort(function (p, q) { return faceEye(q[0], dx, dz) - faceEye(p[0], dx, dz); });
  }

  // scale a whole model uniformly (used to size scene machines)
  function scaleModel(model, k) {
    var sc = function (p) { return [p[0] * k, p[1] * k, p[2] * k]; };
    model.parts.forEach(function (part) {
      part.f = part.f.map(function (face) { return [face[0].map(sc), face[1]]; });
      part.e = part.e.map(function (e) { return { a: sc(e.a), b: sc(e.b), w: e.w, d: e.d }; });
    });
    model.dims = model.dims.map(function (dm) { return { a: sc(dm.a), b: sc(dm.b), label: dm.label }; });
    if (model.joints) model.joints = model.joints.map(function (j) { return { p: sc(j.p), n: j.n }; });
    model.shadowW *= k;
    return model;
  }

  function boxPart(cx, y0, zN, w, h, dep) {
    var x1 = cx - w / 2, x2 = cx + w / 2, y1 = y0, y2 = y0 + h, z1 = zN, z2 = zN + dep;
    return { f: [
      [[[x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2]], 2],
      [[[x1, y1, z2], [x1, y2, z2], [x1, y2, z1], [x1, y1, z1]], 1],
      [[[x2, y1, z2], [x2, y2, z2], [x2, y2, z1], [x2, y1, z1]], 1],
      [[[x1, y2, z2], [x2, y2, z2], [x2, y2, z1], [x1, y2, z1]], 1],
      [[[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]], 1],
      [[[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]], 0]
    ], e: [] };
  }

  // vertical cylinder
  function cylY(cx, y0, zC, r, h, n) {
    n = n || 14;
    var ring = function (y) {
      var pts = [];
      for (var i = 0; i < n; i++) { var a = i / n * 2 * Math.PI; pts.push(P(cx + r * Math.cos(a), y, zC + r * Math.sin(a))); }
      return pts;
    };
    var bot = ring(y0), top = ring(y0 + h), qs = [];
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var mz = (bot[i][2] + bot[j][2] + top[i][2] + top[j][2]) / 4;
      qs.push([mz, [bot[i], bot[j], top[j], top[i]]]);
    }
    qs.sort(function (p, q) { return q[0] - p[0]; });
    var faces = [];
    for (i = 0; i < n; i++) faces.push([qs[i][1], 1]);
    faces.push([top, 1]);
    faces.push([bot, 2]);
    return { f: faces, e: [] };
  }

  // horizontal cylinder along x (wheels, shafts, rollers)
  function cylX(x0, y, zC, r, len, n) {
    n = n || 12;
    var ring = function (x) {
      var pts = [];
      for (var i = 0; i < n; i++) { var a = i / n * 2 * Math.PI; pts.push(P(x, y + r * Math.sin(a), zC + r * Math.cos(a))); }
      return pts;
    };
    var A = ring(x0), B = ring(x0 + len), qs = [];
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var mz = (A[i][2] + A[j][2] + B[i][2] + B[j][2]) / 4;
      qs.push([mz, [A[i], A[j], B[j], B[i]]]);
    }
    qs.sort(function (p, q) { return q[0] - p[0]; });
    var faces = [], e = [];
    for (i = 0; i < n; i++) faces.push([qs[i][1], 1]);
    faces.push([A, 1]); faces.push([B, 1]);
    for (i = 0; i < n; i++) { var j2 = (i + 1) % n; e.push(E(B[i], B[j2], 0)); }
    return { f: faces, e: e };
  }

  // cylinder between two arbitrary points (tubes, wishbones, struts)
  function tube(a, b, r, n) {
    n = n || 8;
    var ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    var L = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= L; ay /= L; az /= L;
    // orthogonal frame
    var ux = 0, uy = 0, uz = 0;
    if (Math.abs(ay) < 0.9) { uy = 1; } else { ux = 1; }
    var vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    var vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    var wx = ay * vz - az * vy, wy = az * vx - ax * vz, wz = ax * vy - ay * vx;
    var A = [], B = [];
    for (var i = 0; i < n; i++) {
      var an = i / n * 2 * Math.PI, c = Math.cos(an) * r, s2 = Math.sin(an) * r;
      A.push(P(a[0] + vx * c + wx * s2, a[1] + vy * c + wy * s2, a[2] + vz * c + wz * s2));
      B.push(P(b[0] + vx * c + wx * s2, b[1] + vy * c + wy * s2, b[2] + vz * c + wz * s2));
    }
    var qs = [];
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var mz = (A[i][2] + A[j][2] + B[i][2] + B[j][2]) / 4;
      qs.push([mz, [A[i], A[j], B[j], B[i]]]);
    }
    qs.sort(function (p, q) { return q[0] - p[0]; });
    var faces = [];
    for (i = 0; i < n; i++) faces.push([qs[i][1], 1]);
    faces.push([A, 1]); faces.push([B, 1]);
    return { f: faces, e: [] };
  }

  // flat ring of points (circle in xz plane at height y, or yz plane at x)
  function ringXZ(cx, y, cz, r, n, x) {
    var pts = [];
    for (var i = 0; i < n; i++) { var a = i / n * 2 * Math.PI; pts.push(x != null ? [x, y + r * Math.sin(a), cz + r * Math.cos(a)] : [cx + r * Math.cos(a), y, cz + r * Math.sin(a)]); }
    return pts;
  }

  // ===== machines (authored about origin x=0, base y=0, near face z=0) =====
  function buildCar() {
    var parts = [];
    var cx = 0;
    // rear wing (far end)
    parts.push(boxPart(cx, 0.98, 0.15, 1.3, 0.06, 0.4));
    parts.push(boxPart(cx - 0.62, 0.5, 0.2, 0.03, 0.55, 0.3));
    parts.push(boxPart(cx + 0.62, 0.5, 0.2, 0.03, 0.55, 0.3));
    parts.push(boxPart(cx - 0.06, 0.55, 0.35, 0.12, 0.45, 0.12)); // struts
    parts.push(boxPart(cx + 0.0, 0.55, 0.35, 0.12, 0.45, 0.12));
    // rear wheels
    parts.push(cylX(cx - 1.28, 0.3, 0.62, 0.3, 0.24, 14));
    parts.push(cylX(cx + 1.04, 0.3, 0.62, 0.3, 0.24, 14));
    // tub + nose (body runs far -> near, z 0.2 .. 2.5)
    parts.push(boxPart(cx - 0.2, 0.18, 0.6, 0.62, 0.4, 1.3));   // main tub (rear-mid)
    parts.push(boxPart(cx - 0.16, 0.22, 1.9, 0.5, 0.26, 0.8));  // nose
    parts.push(boxPart(cx - 0.45, 0.14, 0.75, 0.3, 0.3, 0.9));  // side pod L
    parts.push(boxPart(cx + 0.28, 0.14, 0.75, 0.3, 0.3, 0.9));  // side pod R
    // roll hoop + bracing (tubular space frame)
    parts.push(tube(P(cx - 0.26, 0.55, 0.75), P(cx - 0.26, 1.05, 0.75), 0.03));
    parts.push(tube(P(cx + 0.26, 0.55, 0.75), P(cx + 0.26, 1.05, 0.75), 0.03));
    parts.push(tube(P(cx - 0.26, 1.05, 0.75), P(cx + 0.26, 1.05, 0.75), 0.03));
    parts.push(tube(P(cx - 0.26, 0.58, 1.7), P(cx + 0.26, 0.58, 1.7), 0.025));
    parts.push(tube(P(cx - 0.26, 1.05, 0.75), P(cx - 0.26, 0.58, 1.7), 0.02));
    parts.push(tube(P(cx + 0.26, 1.05, 0.75), P(cx + 0.26, 0.58, 1.7), 0.02));
    // cockpit opening
    var ce = [];
    var c1 = P(cx - 0.17, 0.59, 0.95), c2 = P(cx + 0.17, 0.59, 0.95), c3 = P(cx + 0.17, 0.59, 1.55), c4 = P(cx - 0.17, 0.59, 1.55);
    ce.push(E(c1, c2, 0)); ce.push(E(c2, c3, 0)); ce.push(E(c3, c4, 0)); ce.push(E(c4, c1, 0));
    parts.push({ f: [], e: ce });
    // front wheels
    parts.push(cylX(cx - 1.28, 0.3, 2.3, 0.3, 0.24, 14));
    parts.push(cylX(cx + 1.04, 0.3, 2.3, 0.3, 0.24, 14));
    // wishbones (suspension): two arms per visible wheel
    var wb = [];
    wb.push(tube(P(cx - 1.16, 0.42, 0.72), P(cx - 0.3, 0.32, 0.85), 0.018, 6));
    wb.push(tube(P(cx - 1.16, 0.18, 0.72), P(cx - 0.3, 0.26, 0.85), 0.018, 6));
    wb.push(tube(P(cx + 0.92, 0.42, 0.72), P(cx + 0.18, 0.32, 0.85), 0.018, 6));
    wb.push(tube(P(cx + 1.16, 0.42, 2.4), P(cx + 0.3, 0.3, 2.2), 0.018, 6));
    wb.push(tube(P(cx + 1.16, 0.18, 2.4), P(cx + 0.3, 0.24, 2.2), 0.018, 6));
    for (var i = 0; i < wb.length; i++) parts.push(wb[i]);
    // front wing
    parts.push(boxPart(cx - 0.55, 0.12, 2.75, 1.1, 0.05, 0.35));
    parts.push(boxPart(cx - 0.6, 0.12, 2.7, 0.03, 0.18, 0.3));
    parts.push(boxPart(cx + 0.57, 0.12, 2.7, 0.03, 0.18, 0.3));
    return {
      parts: parts,
      dims: [
        { a: P(cx - 1.28, 0, 0.62), b: P(cx - 1.28, 0, 2.3), label: "1 550 MM" },
        { a: P(cx + 1.35, 0.3, 0.62), b: P(cx + 1.35, 0.3, 2.3), label: null }
      ],
      label: "FORMULA STUDENT CAR", shadowW: 1.6
    };
  }

  function buildPrinter() {
    var parts = [];
    var s = 3.2, cx = 0; // industrial frame ~3.2m
    // stand
    parts.push(boxPart(cx, 0, 0.7, s * 0.8, 0.9, 0.7));
    // frame posts + top frame
    var h = 2.4, py = 0.9;
    parts.push(boxPart(cx - s / 2, py, 0.4, 0.09, h, 0.09));
    parts.push(boxPart(cx + s / 2, py, 0.4, 0.09, h, 0.09));
    parts.push(boxPart(cx - s / 2, py, 1.9, 0.09, h, 0.09));
    parts.push(boxPart(cx + s / 2, py, 1.9, 0.09, h, 0.09));
    parts.push(boxPart(cx, py + h - 0.05, 0.36, s + 0.1, 0.1, 0.12));
    parts.push(boxPart(cx, py + h - 0.05, 1.86, s + 0.1, 0.1, 0.12));
    parts.push(boxPart(cx - s / 2 - 0.02, py, 0.36, 0.13, h, 1.66)); // side skin hint (hairline via edges)
    // gantry rails (horizontal, along x) + carriage + print head
    parts.push(boxPart(cx, py + h - 0.35, 0.95, s - 0.2, 0.12, 0.14));
    parts.push(boxPart(cx - 0.5, py + h - 0.75, 0.88, 0.34, 0.42, 0.3)); // carriage
    parts.push(boxPart(cx - 0.5, py + h - 0.98, 0.94, 0.1, 0.24, 0.16)); // print head
    parts.push(boxPart(cx - 0.53, py + h - 1.06, 0.985, 0.04, 0.1, 0.04)); // nozzle
    // heated build plate + corner bolts
    parts.push(boxPart(cx, py + 0.06, 0.75, s * 0.72, 0.09, 1.4));
    var bl = [], bz = [0.8, 2.1], bx = [cx - s * 0.3, cx + s * 0.3];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) bl.push(E(P(bx[i], py + 0.16, bz[j]), P(bx[i], py + 0.3, bz[j]), 2));
    parts.push({ f: [], e: bl });
    // partly printed part with visible layer lines
    var pyb = py + 0.15;
    for (i = 0; i < 5; i++) parts.push(boxPart(cx + 0.35, pyb + i * 0.09, 1.25, 0.72 - i * 0.05, 0.09, 0.6 - i * 0.04));
    var ll = [];
    for (i = 0; i <= 4; i++) ll.push(E(P(cx + 0.02, pyb + i * 0.09 + 0.005, 1.26), P(cx + 0.68, pyb + i * 0.09 + 0.005, 1.26), 2));
    parts.push({ f: [], e: ll });
    // spool
    parts.push(cylY(cx - s / 2 + 0.2, py + h + 0.05, 1.1, 0.28, 0.16, 12));
    return {
      parts: parts,
      dims: [
        { a: P(cx - s / 2, 0, 0), b: P(cx + s / 2, 0, 0), label: "3 200 MM" },
        { a: P(cx + s / 2 + 0.2, 0, 0.4), b: P(cx + s / 2 + 0.2, py + 0.9 + 2.4, 0.4), label: null }
      ],
      label: "3D PRINTER \u00B7 FDM", shadowW: s * 0.6
    };
  }

  function buildRig() {
    var parts = [];
    var cx = 0, L = 4.2;
    // base plate + bench
    parts.push(boxPart(cx, 0, 0, L, 0.14, 1.5));
    parts.push(boxPart(cx - 1.2, 0.14, 0.3, 0.16, 0.85, 1.0));
    parts.push(boxPart(cx + 1.2, 0.14, 0.3, 0.16, 0.85, 1.0));
    parts.push(boxPart(cx, 0.99, 0.3, L, 0.1, 1.5)); // bench top
    // motor (finned cylinder) at far end
    parts.push(cylX(cx - 1.85, 1.28, 1.05, 0.34, 0.9, 12));
    var fins = [];
    for (var i = 0; i < 4; i++) { var zz = 0.82 + i * 0.16; fins.push(E(P(cx - 1.8, 1.28 - 0.36, zz), P(cx - 1.8, 1.28 + 0.36, zz), 2)); }
    parts.push({ f: [], e: fins });
    // horizontal shaft
    parts.push(cylX(cx - 0.95, 1.28, 1.05, 0.1, 2.5, 10));
    // bearing test housing (near end) with cross-section cover
    parts.push(boxPart(cx + 0.35, 1.06, 0.62, 0.9, 0.85, 0.75));
    parts.push(cylX(cx + 0.82, 1.28, 1.0, 0.62, 0.06, 20)); // cross-section cover disc
    var be = [], n = 20, rr, bb;
    // outer race + bore + pitch circle (front cross-section)
    be.push(E(P(cx + 0.83, 1.28 - 0.58, 1.0), P(cx + 0.83, 1.28 + 0.58, 1.0), 2, true)); // centerline
    var cov = ringXZ(0, 1.28, 1.0, 0.6, 20, cx + 0.83);
    for (i = 0; i < 20; i++) be.push(E(cov[i], cov[(i + 1) % 20], 0));
    var bore = ringXZ(0, 1.28, 1.0, 0.16, 16, cx + 0.83);
    for (i = 0; i < 16; i++) be.push(E(bore[i], bore[(i + 1) % 16], 1));
    var pit = ringXZ(0, 1.28, 1.0, 0.37, 16, cx + 0.83);
    for (i = 0; i < 16; i++) be.push(E(pit[i], pit[(i + 1) % 16], 2, true));
    // balls
    for (i = 0; i < 6; i++) {
      var a = i / 6 * 2 * Math.PI, bxp = cx + 0.83, byp = 1.28 + 0.37 * Math.sin(a), bzp = 1.0 + 0.37 * Math.cos(a);
      var ball = ringXZ(0, byp, bzp, 0.07, 8, bxp);
      for (var k = 0; k < 8; k++) be.push(E(ball[k], ball[(k + 1) % 8], 1));
    }
    parts.push({ f: [], e: be });
    // meshing gear pair with teeth (near the housing)
    parts.push(gear(cx - 0.35, 1.28, 1.05, 0.5, 0.1, 14));
    parts.push(gear(cx + 0.62, 1.28, 1.72, 0.32, 0.09, 10));
    return {
      parts: parts,
      dims: [
        { a: P(cx - 2.1, 0, 0), b: P(cx + 2.1, 0, 0), label: "4 200 MM" }
      ],
      label: "BEARING TEST RIG", shadowW: 2.2
    };
  }

  // gear = disc + radial teeth
  function gear(x, y, z, r, th, nt) {
    var part = cylX(x, y, z, r, th, 18);
    var te = [], tf = [];
    for (var i = 0; i < nt; i++) {
      var a = i / nt * 2 * Math.PI, a2 = (i + 0.5) / nt * 2 * Math.PI;
      var c = Math.cos(a), s2 = Math.sin(a), c2 = Math.cos(a2), s22 = Math.sin(a2);
      var r2 = r + 0.09;
      var p1 = P(x, y + r * s2, z + r * c), p2 = P(x + th, y + r * s2, z + r * c);
      var p3 = P(x + th, y + r2 * s2, z + r2 * c), p4 = P(x, y + r2 * s2, z + r2 * c);
      tf.push([[p1, p2, p3, p4], 1]);
      te.push(E(P(x, y + r2 * s2, z + r2 * c), P(x + th, y + r2 * s2, z + r2 * c), 2));
      void c2; void s22;
    }
    part.f = part.f.concat(tf);
    part.e = part.e.concat(te);
    return part;
  }

  function buildRefinery() {
    var parts = [];
    var cx = 0, zC = 0.9, r = 1.05, base = 0;
    // skirt
    parts.push(cylY(cx, 0, zC, r + 0.12, 1.3, 16));
    // vessel + rounded top
    parts.push(cylY(cx, 1.3, zC, r, 5.6, 16));
    parts.push(cylY(cx, 6.9, zC, r * 0.94, 0.55, 16));
    parts.push(cylY(cx, 7.45, zC, r * 0.72, 0.5, 14));
    parts.push(cylY(cx, 7.95, zC, r * 0.34, 0.45, 10));
    // internal tray lines (hidden, dashed)
    var tr = [];
    for (var i = 0; i < 5; i++) {
      var y = 2.0 + i * 1.05;
      tr.push(E(P(cx - r * 0.92, y, zC), P(cx + r * 0.92, y, zC), 2, true));
    }
    parts.push({ f: [], e: tr });
    // side pipework: vertical line + flanges + elbows
    parts.push(cylY(cx + r + 0.5, 0.4, zC + 0.4, 0.09, 3.4, 8));
    parts.push(cylY(cx + r + 0.5, 3.8, zC + 0.4, 0.16, 0.12, 8)); // flange
    parts.push(boxPart(cx + r + 0.28, 4.0, zC + 0.28, 0.5, 0.18, 0.18)); // elbow into vessel
    parts.push(cylY(cx + r + 0.5, 1.6, zC + 0.4, 0.15, 0.12, 8)); // lower flange
    // walkway platform + stair
    parts.push(boxPart(cx, 4.4, zC + r + 0.5, 2.6, 0.07, 0.7));
    var rail = [];
    rail.push(E(P(cx - 1.3, 5.1, zC + r + 0.85), P(cx + 1.3, 5.1, zC + r + 0.85), 1));
    rail.push(E(P(cx - 1.3, 4.47, zC + r + 0.85), P(cx - 1.3, 5.1, zC + r + 0.85), 1));
    rail.push(E(P(cx + 1.3, 4.47, zC + r + 0.85), P(cx + 1.3, 5.1, zC + r + 0.85), 1));
    parts.push({ f: [], e: rail });
    var st = [];
    for (i = 0; i < 7; i++) {
      var sy = 4.44 - i * 0.62, sz = zC + r + 0.85 + i * 0.34;
      st.push(E(P(cx - 0.9, sy, sz), P(cx - 0.1, sy, sz), 2));
      if (i < 6) st.push(E(P(cx - 0.9, sy, sz), P(cx - 0.9, sy - 0.62, sz + 0.34), 2));
    }
    parts.push({ f: [], e: st });
    return {
      parts: parts,
      dims: [
        { a: P(cx + r + 0.9, 0, zC), b: P(cx + r + 0.9, 8.4, zC), label: "9 000 MM" }
      ],
      label: "REFINERY COLUMN", shadowW: 1.5
    };
  }

  function buildDock(withFleet) {
    var parts = [];
    var cx = 0;
    // raised dock platform (near, left)
    parts.push(boxPart(cx - 3.6, 0, 0, 3.0, 1.25, 2.4));
    var bump = [];
    bump.push(E(P(cx - 2.15, 0.9, 0.02), P(cx - 2.15, 1.05, 0.02), 2));
    bump.push(E(P(cx - 4.95, 0.9, 0.02), P(cx - 4.95, 1.05, 0.02), 2));
    parts.push({ f: [], e: bump });
    // roller conveyor running in (into the truck)
    parts.push(boxPart(cx - 2.4, 0.95, 1.0, 2.6, 0.08, 2.6));
    for (var i = 0; i < 7; i++) parts.push(cylX(cx - 3.5 + i * 0.36, 1.03, 1.15, 0.05, 2.2, 6));
    // freight truck backed in (container + cab beyond dock, far)
    var tx = cx + 1.2;
    parts.push(boxPart(tx, 0.75, 1.7, 2.5, 2.6, 6.2));   // container body
    parts.push(boxPart(tx, 0.55, 8.0, 2.3, 1.7, 1.6));   // cab
    parts.push(boxPart(tx - 0.9, 0.42, 0.95, 0.5, 0.4, 0.5)); // landing gear
    parts.push(boxPart(tx + 0.7, 0.42, 0.95, 0.5, 0.4, 0.5));
    // wheels
    parts.push(cylX(tx - 1.0, 0.34, 1.9, 0.34, 0.22, 10));
    parts.push(cylX(tx + 0.76, 0.34, 1.9, 0.34, 0.22, 10));
    parts.push(cylX(tx - 1.0, 0.34, 2.75, 0.34, 0.22, 10));
    parts.push(cylX(tx + 0.76, 0.34, 2.75, 0.34, 0.22, 10));
    parts.push(cylX(tx - 0.85, 0.34, 8.35, 0.34, 0.2, 10));
    parts.push(cylX(tx + 0.62, 0.34, 8.35, 0.34, 0.2, 10));
    if (withFleet) {
      // two fleet vehicles parked beside the dock
      for (var v = 0; v < 2; v++) {
        var vx = cx - 5.6 + v * 0.2, vz = 5.0 + v * 3.2, vw = 1.7;
        parts.push(boxPart(vx, 0.45, vz, vw, 1.35, 3.4));       // van body
        parts.push(boxPart(vx, 0.4, vz + 3.3, vw * 0.9, 0.9, 1.0)); // cab
        parts.push(cylX(vx - vw / 2 + 0.15, 0.22, vz + 0.6, 0.22, 0.16, 8));
        parts.push(cylX(vx + vw / 2 - 0.3, 0.22, vz + 0.6, 0.22, 0.16, 8));
        parts.push(cylX(vx - vw / 2 + 0.15, 0.22, vz + 3.5, 0.22, 0.16, 8));
        parts.push(cylX(vx + vw / 2 - 0.3, 0.22, vz + 3.5, 0.22, 0.16, 8));
      }
    }
    return {
      parts: parts,
      dims: [
        { a: P(tx - 1.25, 0, 1.7), b: P(tx - 1.25, 0, 7.9), label: withFleet ? "40 FT" : "40 FT BOX" }
      ],
      label: "LOADING DOCK", shadowW: 4.4
    };
  }

  function buildCell() {
    var parts = [];
    var cx = 0, w = 6.5, dep = 4.4, h = 2.6;
    // safety fencing: posts + hairline mesh
    var i, px;
    for (i = 0; i <= 6; i++) {
      px = cx - w / 2 + i * (w / 6);
      parts.push(boxPart(px, 0, 0, 0.07, h, 0.07));
      parts.push(boxPart(px, 0, dep, 0.07, h, 0.07));
    }
    parts.push(boxPart(cx, h - 0.05, 0, w, 0.07, 0.07));
    parts.push(boxPart(cx, h - 0.05, dep, w, 0.07, 0.07));
    parts.push(boxPart(cx - w / 2, h - 0.05, 0, 0.07, 0.07, dep));
    parts.push(boxPart(cx + w / 2, h - 0.05, 0, 0.07, 0.07, dep));
    var mesh = [];
    for (i = 1; i < 10; i++) {
      var my = h * i / 10;
      mesh.push(E(P(cx - w / 2, my, 0.04), P(cx + w / 2, my, 0.04), 2));
      mesh.push(E(P(cx - w / 2, my, dep - 0.04), P(cx + w / 2, my, dep - 0.04), 2));
    }
    parts.push({ f: [], e: mesh });
    // six-axis arm: base, three joints, forearm, gripper
    var ax = cx - 0.8;
    parts.push(cylY(ax, 0.12, 2.0, 0.5, 0.3, 14));            // base
    parts.push(cylY(ax, 0.42, 2.0, 0.22, 0.85, 10));          // shoulder column
    parts.push(cylY(ax, 1.27, 2.0, 0.3, 0.34, 10));           // joint 1
    parts.push(tube(P(ax, 1.5, 2.0), P(ax - 0.15, 2.15, 1.35), 0.13)); // upper arm
    parts.push(cylY(ax - 0.15, 2.15, 1.35, 0.24, 0.3, 10));   // joint 2
    parts.push(tube(P(ax - 0.15, 2.3, 1.35), P(ax + 0.75, 1.9, 0.9), 0.1)); // forearm
    parts.push(cylY(ax + 0.75, 1.82, 0.9, 0.17, 0.22, 8));    // joint 3 / wrist
    parts.push(boxPart(ax + 0.72, 1.56, 0.82, 0.14, 0.3, 0.14)); // gripper body
    parts.push(boxPart(ax + 0.62, 1.44, 0.84, 0.05, 0.16, 0.05)); // finger
    parts.push(boxPart(ax + 0.86, 1.44, 0.84, 0.05, 0.16, 0.05)); // finger
    // conveyor beside the arm
    parts.push(boxPart(cx + 2.2, 0.55, 0.6, 1.6, 0.1, 3.6));
    parts.push(boxPart(cx + 2.2, 0.3, 0.7, 1.4, 0.25, 3.4));
    for (i = 0; i < 5; i++) parts.push(boxPart(cx + 2.2, 0.05, 0.9 + i * 0.7, 1.3, 0.25, 0.08));
    return {
      parts: parts,
      dims: [
        { a: P(cx - w / 2, 0, 0), b: P(cx + w / 2, 0, 0), label: "6 500 MM" }
      ],
      label: "ROBOTIC CELL", shadowW: 3.4
    };
  }

  // a standalone six-axis arm. `pose` swings the elbow and wrist so the few
  // arms on the line don't read as clones of each other.
  var ARM_POSES = [
    { ex: -0.15, ey: 2.15, ez: 1.35, wx: 0.75, wy: 1.90, wz: 0.90 },
    { ex: 0.34, ey: 2.28, ez: 1.58, wx: 1.08, wy: 1.32, wz: 1.12 },
    { ex: -0.42, ey: 2.02, ez: 1.18, wx: -1.05, wy: 1.58, wz: 0.98 }
  ];
  function buildArm(pose) {
    var p = ARM_POSES[(pose || 0) % ARM_POSES.length];
    var parts = [], ax = 0;
    parts.push(cylY(ax, 0.12, 2.0, 0.5, 0.3, 14));
    parts.push(cylY(ax, 0.42, 2.0, 0.22, 0.85, 10));
    parts.push(cylY(ax, 1.27, 2.0, 0.3, 0.34, 10));
    parts.push(tube(P(ax, 1.5, 2.0), P(ax + p.ex, p.ey, p.ez), 0.13));
    parts.push(cylY(ax + p.ex, p.ey, p.ez, 0.24, 0.3, 10));
    parts.push(tube(P(ax + p.ex, p.ey + 0.15, p.ez), P(ax + p.wx, p.wy, p.wz), 0.1));
    parts.push(cylY(ax + p.wx, p.wy - 0.08, p.wz, 0.17, 0.22, 8));
    parts.push(boxPart(ax + p.wx - 0.03, p.wy - 0.34, p.wz - 0.08, 0.14, 0.3, 0.14));
    parts.push(boxPart(ax + p.wx - 0.13, p.wy - 0.46, p.wz - 0.06, 0.05, 0.16, 0.05));
    parts.push(boxPart(ax + p.wx + 0.11, p.wy - 0.46, p.wz - 0.06, 0.05, 0.16, 0.05));
    return {
      parts: parts,
      dims: [],
      joints: [
        { p: P(ax, 1.42, 2.0), n: "J1" },
        { p: P(ax + p.ex, p.ey, p.ez), n: "J2" },
        { p: P(ax + p.wx, p.wy - 0.08, p.wz), n: "J3" }
      ],
      label: "ROBOTIC ARM", shadowW: 1.1
    };
  }

  // the same arm with a crate in the gripper and a stack waiting on the
  // floor — the loading-dock marker, so the Route reads as handling freight
  function buildArmBox(pose) {
    var p = ARM_POSES[(pose || 0) % ARM_POSES.length];
    var m = buildArm(pose);
    var gx = p.wx, gy = p.wy - 0.78, gz = p.wz - 0.06;
    m.parts.push(boxPart(gx, gy, gz - 0.3, 0.62, 0.5, 0.62));   // crate in the gripper
    var band = [];
    band.push(E(P(gx - 0.31, gy + 0.25, gz - 0.3), P(gx + 0.31, gy + 0.25, gz - 0.3), 1));
    m.parts.push({ f: [], e: band });
    m.parts.push(boxPart(1.9, 0, 1.2, 0.72, 0.58, 0.72));       // stack waiting below
    m.parts.push(boxPart(1.9, 0.58, 1.25, 0.62, 0.5, 0.62));
    m.shadowW = 1.9;
    m.label = "ARM AND CRATE";
    return m;
  }

  // abstract primitives on a plinth — the On Call marker. No machine, just
  // the geometry every drawing is built from.
  function buildGeoForms() {
    var parts = [], e, i;
    parts.push(boxPart(0, 0, -1.0, 3.2, 0.34, 2.0));            // plinth
    parts.push(boxPart(-0.95, 0.34, -0.75, 1.15, 1.15, 1.15));  // cube
    // a sphere read as three great circles, floating over the cube
    var sx = -0.95, sy = 2.55, sz = -0.18, r = 0.66;
    e = [];
    for (i = 0; i < 22; i++) {
      var a = i / 22 * Math.PI * 2, b = (i + 1) / 22 * Math.PI * 2;
      e.push(E(P(sx + Math.cos(a) * r, sy + Math.sin(a) * r, sz),
               P(sx + Math.cos(b) * r, sy + Math.sin(b) * r, sz), 1));
      e.push(E(P(sx + Math.cos(a) * r, sy, sz + Math.sin(a) * r),
               P(sx + Math.cos(b) * r, sy, sz + Math.sin(b) * r), 1));
      e.push(E(P(sx, sy + Math.cos(a) * r, sz + Math.sin(a) * r),
               P(sx, sy + Math.cos(b) * r, sz + Math.sin(b) * r), 1));
    }
    parts.push({ f: [], e: e });
    // a tetrahedron sharing the plinth
    var tx = 1.15, ty = 0.34, tz = -0.3, t = 0.82;
    var v1 = P(tx - t, ty, tz - t * 0.55), v2 = P(tx + t, ty, tz - t * 0.55),
        v3 = P(tx, ty, tz + t * 0.85), ap = P(tx, ty + t * 1.6, tz - t * 0.08);
    parts.push({ f: [], e: [
      E(v1, v2, 0), E(v2, v3, 0), E(v3, v1, 0),
      E(v1, ap, 0), E(v2, ap, 0), E(v3, ap, 0)
    ] });
    return { parts: parts, dims: [], label: "PRIMITIVES", shadowW: 1.7 };
  }

  // A flat ring of edges in the X-Y plane (constant z). Every point shares a
  // depth, so it projects as a true circle instead of the barrel you get from
  // the cylinder helpers, whose discs face sideways in this camera.
  function faceLoop(cy, cz, r, n, w) {
    var pts = [], e = [], i;
    for (i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      pts.push(P(Math.cos(a) * r, cy + Math.sin(a) * r, cz));
    }
    for (i = 0; i < n; i++) e.push(E(pts[i], pts[(i + 1) % n], w));
    return e;
  }

  // a shift clock on a post — the Off-Shift marker
  function buildClock() {
    var parts = [], cy = 3.5, cz = 0, r = 1.05, i;
    // the post stops below the dial and sits behind it, so the hands read
    parts.push(boxPart(0, 0, 0.1, 0.32, cy - r - 0.05, 0.32));
    parts.push({ f: [], e: faceLoop(cy, cz, r, 24, 1) });
    parts.push({ f: [], e: faceLoop(cy, cz, r * 0.84, 24, 1) });
    var e = [];
    // hands set on the 5 and the 9 — the hours that are nobody else's
    e.push(E(P(0, cy, cz), P(r * 0.48 * 0.5, cy - r * 0.48 * 0.866, cz), 0));
    e.push(E(P(0, cy, cz), P(-r * 0.74, cy, cz), 0));
    // hour ticks
    for (i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2;
      e.push(E(
        P(Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84, cz),
        P(Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, cz), 1));
    }
    parts.push({ f: [], e: e });
    return { parts: parts, dims: [], label: "SHIFT CLOCK", shadowW: 0.9 };
  }

  // a gear standing on a plinth, face on — the Blueprint marker
  function buildGearFace() {
    var parts = [], cy = 2.0, cz = 0, rO = 1.3, rI = 1.02, teeth = 10, i;
    parts.push(boxPart(0, 0, -0.16, 0.9, 0.3, 0.9));
    parts.push(boxPart(0, 0.3, -0.12, 0.26, cy - 0.3, 0.24));
    var pts = [];
    for (i = 0; i < teeth; i++) {
      var a0 = i / teeth * Math.PI * 2, st = Math.PI * 2 / teeth;
      [[a0, rI], [a0 + st * 0.16, rI], [a0 + st * 0.3, rO],
       [a0 + st * 0.7, rO], [a0 + st * 0.84, rI]].forEach(function (q) {
        pts.push(P(Math.cos(q[0]) * q[1], cy + Math.sin(q[0]) * q[1], cz));
      });
    }
    var e = [];
    for (i = 0; i < pts.length; i++) e.push(E(pts[i], pts[(i + 1) % pts.length], 1));
    parts.push({ f: [], e: e });
    parts.push({ f: [], e: faceLoop(cy, cz, rI * 0.62, 20, 1) });
    parts.push({ f: [], e: faceLoop(cy, cz, 0.3, 14, 1) });
    return { parts: parts, dims: [], label: "GEAR", shadowW: 1.0 };
  }

  // a satellite on its stand — the On Call marker, deep tech rather than
  // plain telecoms: bus, solar wings, dish and a little orbit ring
  function buildSatellite() {
    var parts = [], cy = 3.1, i;
    parts.push(boxPart(0, 0, -0.16, 0.3, cy - 1.0, 0.3));
    parts.push(boxPart(0, cy - 1.0, -0.5, 1.2, 1.1, 1.0));
    // solar wings
    parts.push(boxPart(-2.4, cy - 0.75, -0.35, 1.7, 0.08, 0.7));
    parts.push(boxPart(0.7, cy - 0.75, -0.35, 1.7, 0.08, 0.7));
    var ribs = [];
    for (i = 1; i < 4; i++) {
      ribs.push(E(P(-2.4 + i * 0.42, cy - 0.75, -0.35), P(-2.4 + i * 0.42, cy - 0.67, 0.35), 1));
      ribs.push(E(P(0.7 + i * 0.42, cy - 0.75, -0.35), P(0.7 + i * 0.42, cy - 0.67, 0.35), 1));
    }
    parts.push({ f: [], e: ribs });
    // dish and orbit ring
    parts.push({ f: [], e: faceLoop(cy + 0.55, 0, 0.5, 16, 1) });
    parts.push({ f: [], e: faceLoop(cy + 0.55, 0, 0.22, 12, 1) });
    parts.push({ f: [], e: faceLoop(cy - 0.45, 0, 2.5, 28, 1) });
    return { parts: parts, dims: [], label: "SATELLITE", shadowW: 1.2 };
  }

  function buildAntenna() {
    var parts = [], i, j, k;
    parts.push(boxPart(0, 0, -0.18, 0.36, 3.3, 0.36));
    var braces = [];
    for (i = 0; i < 3; i++) {
      var y0 = 0.45 + i * 0.95;
      braces.push(E(P(-0.18, y0, 0), P(0.18, y0 + 0.95, 0), 1));
      braces.push(E(P(0.18, y0, 0), P(-0.18, y0 + 0.95, 0), 1));
    }
    parts.push({ f: [], e: braces });
    parts.push(cylX(-0.11, 3.6, 0.5, 0.8, 0.22, 12));
    var arcs = [];
    for (k = 1; k <= 3; k++) {
      var r = 0.55 + k * 0.42, pts = [];
      for (var a = -0.75; a <= 0.75; a += 0.15) {
        pts.push(P(0, 3.6 + Math.sin(a) * r, 0.5 + Math.cos(a) * r));
      }
      for (j = 0; j < pts.length - 1; j++) arcs.push(E(pts[j], pts[j + 1], 1));
    }
    parts.push({ f: [], e: arcs });
    return { parts: parts, dims: [], label: "COMMS MAST", shadowW: 0.95 };
  }

  // a process chamber — octagonal vessel on a plinth with two port stubs.
  // Stands in for the semiconductor work without the clutter of a full cell.
  function buildChamber() {
    var parts = [];
    parts.push(boxPart(0, 0, -1.1, 2.6, 0.5, 2.2));
    parts.push(cylY(0, 0.5, 0, 1.15, 1.5, 8));
    parts.push(cylY(0, 2.0, 0, 1.3, 0.22, 8));
    parts.push(cylX(-2.0, 1.2, 0, 0.3, 0.9, 8));
    parts.push(cylX(1.1, 1.2, 0, 0.3, 0.9, 8));
    return { parts: parts, dims: [], label: "PROCESS CHAMBER", shadowW: 1.8 };
  }

  // a shell-and-tube heat exchanger: two vessels on saddles, crossover pipe
  function buildExchanger() {
    var parts = [];
    parts.push(boxPart(-1.0, 0, -0.5, 0.5, 0.75, 1.0));
    parts.push(boxPart(1.0, 0, -0.5, 0.5, 0.75, 1.0));
    parts.push(cylX(-1.8, 1.1, 0, 0.55, 3.6, 12));
    parts.push(cylX(-1.5, 2.3, 0, 0.42, 3.0, 12));
    parts.push(tube(P(1.8, 1.1, 0), P(1.5, 2.3, 0), 0.13, 8));
    return { parts: parts, dims: [], label: "HEAT EXCHANGER", shadowW: 2.2 };
  }

  // gears on a workbench
  function buildGearSet() {
    var parts = [];
    parts.push(boxPart(0, 0.72, -0.7, 2.4, 0.12, 1.4));
    parts.push(boxPart(-1.0, 0, -0.6, 0.14, 0.72, 0.14));
    parts.push(boxPart(1.0, 0, -0.6, 0.14, 0.72, 0.14));
    parts.push(cylX(-0.2, 1.44, -0.1, 0.6, 0.18, 10));
    parts.push(cylX(0.45, 1.18, 0.2, 0.36, 0.16, 8));
    return { parts: parts, dims: [], label: "GEAR SET", shadowW: 1.4 };
  }

  // a pallet of car parts — wheels and a body panel
  function buildPartsPallet() {
    var parts = [];
    parts.push(boxPart(0, 0, -0.8, 1.8, 0.16, 1.6));
    parts.push(boxPart(0, 0.16, -0.75, 1.7, 0.08, 1.5));
    parts.push(cylX(-0.75, 0.52, -0.3, 0.33, 0.22, 10));
    parts.push(cylX(0.18, 0.52, -0.3, 0.33, 0.22, 10));
    parts.push(boxPart(0.1, 0.24, 0.35, 1.2, 0.85, 0.08));
    return { parts: parts, dims: [], label: "PARTS PALLET", shadowW: 1.3 };
  }

  // ===== machine registry ===== (also used by the Shop Floor row schematics)
  var DEFS = {
    car: { build: buildCar },
    printer: { build: buildPrinter },
    rig: { build: function () { return scaleModel(buildRig(), 1.3); } },
    dock: { build: function () { return buildDock(false); } },
    dockFleet: { build: function () { return buildDock(true); } },
    refinery: { build: buildRefinery },
    cell: { build: function () { return scaleModel(buildCell(), 1.5); } },
    arm: { build: buildArm },
    chamber: { build: buildChamber },
    exchanger: { build: buildExchanger },
    gearSet: { build: buildGearSet },
    partsPallet: { build: buildPartsPallet },
    clock: { build: buildClock },
    gearFace: { build: buildGearFace },
    antenna: { build: buildAntenna },
    satellite: { build: buildSatellite },
    armBox: { build: function () { return buildArmBox(2); } },
    geoForms: { build: buildGeoForms }
  };

  // sections the sheet-number / progress bar / nav highlight track (independent of the backdrop)
  var SECTIONS = ["hero", "blueprint", "route", "shop-floor", "off-shift", "on-call"];

  // ===== the line =====
  // One continuous production line rather than a yard full of scattered
  // props: the stations sit along the centre line, alternating sides, and
  // scrolling walks the camera down it. Because only a short window of
  // depth is ever in shot, the frame stays sparse no matter how many
  // stations the line has. Every station is equipment from the portfolio.
  // x = lateral metres off the line, z = metres downrange.
  // The flow, in process order — inbound at the top of the page, outbound at
  // the bottom. Each bay is equipment from a real project; `tag` is stencilled
  // on the floor beside it. Arms appear only where robotics is the subject:
  // the fab bay (current work) and robotic unloading at inbound.
  // One marker per page section, so whatever is on screen belongs to the
  // section you are reading. `sec` ties each bay to its section; the depths
  // are derived from where that section actually sits in the scroll (see
  // layoutStations), so the object reaches the front exactly as you arrive.
  var STATIONS = [
    { sec: "hero", side: 1, joints: true, items: [
      { def: "arm", x: 6.8, pose: 0, k: 3.1 },
      // further downrange, so they read as plant behind the arm rather than
      // beside it: smaller, higher in frame, well clear of the headline
      { def: "refinery", x: 16.2, dz: 10, k: 0.8 },
      { def: "gearSet", x: 8.8, dz: -4, k: 1.1 }
    ] },
    { sec: "blueprint", tag: "AM-601 · GEARS", side: 1, items: [
      { def: "gearFace", x: 8.5, k: 1.9 }
    ] },
    { sec: "route", tag: "TM-301 · LOADING", side: 1, items: [
      { def: "dock", x: 17.5, dz: 7, k: 0.95 },
      { def: "armBox", x: 10.5, dz: 1.5, k: 1.0 }
    ] },
    { sec: "shop-floor", tag: "RC-101 · FAB", side: 1, items: [
      { def: "chamber", x: 8.6, k: 1.3 },
      { def: "arm", x: 3.0, dz: -5.5, pose: 1, k: 1.4 }
    ] },
    { sec: "off-shift", tag: "OFF · 5 TO 9", side: 1, items: [
      { def: "clock", x: 9, k: 1.6, a: 1.8 }
    ] },
    { sec: "on-call", tag: "ON CALL", side: 1, items: [
      { def: "geoForms", x: 8.8, k: 1.5 }
    ] }
  ];
  var TRAVEL = 300;   // metres walked from the top of the page to the bottom
  var NEAR_CULL = 7;  // bays nearer than this have been passed
  var FAR_CULL = 72;  // and beyond this they are still over the horizon
  var FOCUS_Z = 26;   // the depth a bay reads as "arrived at"
  var camZ = 0, camZTarget = 0;

  var OBJS = []; // bays: {cfg, items:[{def, x, dz, a}]}
  function buildScene() {
    OBJS = STATIONS.filter(function (s) { return !!d.getElementById(s.sec); }).map(function (s) {
      return {
        cfg: s,
        items: s.items.map(function (it) {
          var m = DEFS[it.def].build(it.pose);
          if (it.k && it.k !== 1) m = scaleModel(m, it.k);
          return { def: m, x: it.x, dz: it.dz || 0, a: it.a || 1 };
        })
      };
    });
  }

  // how far down the line the page has walked us
  function scrollCamZ() {
    var docH = d.documentElement.scrollHeight - H;
    var p = docH > 0 ? window.scrollY / docH : 0;
    return Math.max(0, Math.min(1, p)) * TRAVEL;
  }

  // ===== renderer =====
  function facePath(c2, pts, proj, dx, dz) {
    c2.beginPath();
    var started = false;
    for (var i = 0; i < pts.length; i++) {
      var p = proj(pts[i][0] + dx, pts[i][1], pts[i][2] + dz);
      if (!p) return false;
      if (!started) { c2.moveTo(p[0], p[1]); started = true; } else c2.lineTo(p[0], p[1]);
    }
    c2.closePath();
    return true;
  }

  // draw one machine model; proj = projection fn, o = {dx, dz, alpha, df, shadow}
  function drawModel(c2, model, proj, o) {
    o = o || {};
    var dx = o.dx || 0, dz = o.dz || 0, alpha = o.alpha == null ? 1 : o.alpha, df = o.df == null ? 1 : o.df;
    // `simple` drops the hairline detail (weight 2) and keeps the silhouette
    // and object edges — used for the backdrop so the shapes read cleanly at
    // low opacity. The Shop Floor card schematics never pass it.
    var simple = !!o.simple;
    var fillA = alpha * Math.min(1, Math.max(0, (df - 0.12) / 0.4));
    var parts = model.parts, i, k;
    for (i = 0; i < parts.length; i++) {
      var part = parts[i], es = part.e;
      var faces = paintSort(part.f, dx, dz);
      for (k = 0; k < faces.length; k++) {
        var pts = faces[k][0], wt = faces[k][1];
        if (simple && wt === 2) continue;
        if (fillA > 0.02) {
          if (facePath(c2, pts, proj, dx, dz)) {
            c2.globalAlpha = fillA;
            c2.fillStyle = BG;
            c2.fill();
          }
        }
        // stroke the face outline as its own edge (partial with df)
        strokePoly(c2, pts, proj, dx, dz, wt, alpha, df, false);
      }
      for (k = 0; k < es.length; k++) {
        var e = es[k];
        if (simple && e.w === 2) continue;
        strokeSeg(c2, e.a, e.b, proj, dx, dz, e.w, alpha, df, e.d);
      }
    }
    c2.globalAlpha = 1;
  }

  function strokePoly(c2, pts, proj, dx, dz, wt, alpha, df, close) {
    c2.globalAlpha = alpha;
    c2.lineWidth = WT[wt] * (mobile ? 0.9 : 1);
    c2.strokeStyle = wt === 2 ? PALE : BLUE;
    if (df < 0.999) {
      var n = Math.max(1, Math.round(pts.length * df));
      for (var i = 0; i < n - 0; i++) {
        var p1 = proj(pts[i][0] + dx, pts[i][1], pts[i][2] + dz);
        var p2 = proj(pts[(i + 1) % pts.length][0] + dx, pts[(i + 1) % pts.length][1], pts[(i + 1) % pts.length][2] + dz);
        if (!p1 || !p2) continue;
        c2.beginPath(); c2.moveTo(p1[0], p1[1]); c2.lineTo(p2[0], p2[1]); c2.stroke();
      }
      if (df >= 0.999) {}
    } else {
      if (!facePath(c2, pts, proj, dx, dz)) { c2.globalAlpha = 1; return; }
      c2.stroke();
    }
    c2.globalAlpha = 1;
  }

  function strokeSeg(c2, a, b, proj, dx, dz, wt, alpha, df, dash) {
    var p = proj(a[0] + dx, a[1], a[2] + dz), q = proj(b[0] + dx, b[1], b[2] + dz);
    if (!p || !q) return;
    c2.globalAlpha = alpha;
    c2.lineWidth = WT[wt] * (mobile ? 0.9 : 1);
    c2.strokeStyle = wt === 2 ? PALE : BLUE;
    c2.setLineDash(dash ? [4, 4] : []);
    c2.beginPath();
    c2.moveTo(p[0], p[1]);
    c2.lineTo(p[0] + (q[0] - p[0]) * df, p[1] + (q[1] - p[1]) * df);
    c2.stroke();
    c2.setLineDash([]);
    c2.globalAlpha = 1;
  }


  // ===== dimension lines =====
  function drawDim(dm, proj, dx, dz, alpha) {
    var p = proj(dm.a[0] + dx, dm.a[1], dm.a[2] + dz), q = proj(dm.b[0] + dx, dm.b[1], dm.b[2] + dz);
    if (!p || !q) return;
    var off = 30, ey = H * 0.0; // offset downward in screen space
    var ax = p[0], ay = p[1] + off, bx = q[0], by = q[1] + off;
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = PALE;
    ctx.lineWidth = WT[2];
    // extension ticks
    ctx.beginPath();
    ctx.moveTo(p[0], p[1] + 6); ctx.lineTo(ax, ay);
    ctx.moveTo(q[0], q[1] + 6); ctx.lineTo(bx, by);
    ctx.stroke();
    // dimension line with arrowheads
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    var ang = Math.atan2(by - ay, bx - ax), hl = 6;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(ax + hl * Math.cos(ang + 0.5), ay + hl * Math.sin(ang + 0.5));
    ctx.moveTo(ax, ay); ctx.lineTo(ax + hl * Math.cos(ang - 0.5), ay + hl * Math.sin(ang - 0.5));
    ctx.moveTo(bx, by); ctx.lineTo(bx - hl * Math.cos(ang + 0.5), by - hl * Math.sin(ang + 0.5));
    ctx.moveTo(bx, by); ctx.lineTo(bx - hl * Math.cos(ang - 0.5), by - hl * Math.sin(ang - 0.5));
    ctx.stroke();
    // short perpendicular ticks
    ctx.beginPath();
    ctx.moveTo(ax - Math.sin(ang) * 4, ay + Math.cos(ang) * 4); ctx.lineTo(ax + Math.sin(ang) * 4, ay - Math.cos(ang) * 4);
    ctx.moveTo(bx - Math.sin(ang) * 4, by + Math.cos(ang) * 4); ctx.lineTo(bx + Math.sin(ang) * 4, by - Math.cos(ang) * 4);
    ctx.stroke();
    if (dm.label) {
      var mx = (ax + bx) / 2, my2 = (ay + by) / 2 - 6;
      ctx.font = '9px "IBM Plex Mono", monospace';
      try { ctx.letterSpacing = "1.5px"; } catch (err) {}
      ctx.fillStyle = SLATE;
      ctx.textAlign = "center";
      ctx.globalAlpha = alpha;
      ctx.fillText(dm.label, mx, my2);
      try { ctx.letterSpacing = "0px"; } catch (err) {}
      ctx.textAlign = "left";
    }
    ctx.globalAlpha = 1;
  }

  // ===== scroll model =====
  var secs = [], centers = [];
  function measure() {
    // only the sections this page actually carries
    secs = SECTIONS.map(function (id) { return d.getElementById(id); })
      .filter(function (el) { return !!el; });
    centers = secs.map(function (el) {
      var r = el.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2;
    });
    layoutStations();
  }

  // Place each bay at the depth that brings it to the front exactly as its
  // section is being read. Derived from the real section offsets rather than
  // hardcoded, so it stays aligned whatever the copy does to page height.
  function layoutStations() {
    var docH = d.documentElement.scrollHeight - H;
    if (docH <= 0) return;
    STATIONS.forEach(function (st) {
      var el = d.getElementById(st.sec);
      if (!el) return;
      // the scroll offset at which this section is settled at the top
      var at = el.getBoundingClientRect().top + window.scrollY;
      var frac = Math.max(0, Math.min(1, at / docH));
      st.z = FOCUS_Z + frac * TRAVEL;
    });
  }
  function scrollT() {
    var c = window.scrollY + H * 0.5;
    if (c <= centers[0]) return 0;
    var last = centers.length - 1;
    if (c >= centers[last]) return last;
    for (var i = 0; i < last; i++) {
      if (c >= centers[i] && c < centers[i + 1]) {
        var f = (c - centers[i]) / (centers[i + 1] - centers[i]);
        f = f * f * (3 - 2 * f); // smoothstep
        return i + f;
      }
    }
    return last;
  }

  // ===== the floor =====
  // Bay lines across the line and column lines running down it, anchored in
  // world space so they stream toward you as the camera walks forward.
  //
  // Hover is grid-only, and it lights the *tiles*, not the lines: a soft
  // pool of light pools on the squares under the cursor and slides with it.
  var BAY_SPACING = 6;
  var COL_X = [];
  for (var _cx = -30; _cx <= 30; _cx += 5) COL_X.push(_cx);

  function drawGround(mx, my, amp) {
    var i, j, p1, p2;
    var nearZ = NEAR_CULL, farZ = FAR_CULL;
    var xMin = COL_X[0], xMax = COL_X[COL_X.length - 1];

    // the bay lines currently in the window, world-anchored
    var bayZ = [];
    var kStart = Math.ceil((camZ + nearZ) / BAY_SPACING);
    var kEnd = Math.floor((camZ + farZ) / BAY_SPACING);
    for (var k = kStart; k <= kEnd; k++) bayZ.push(k * BAY_SPACING - camZ);

    // ---- tile glow under the cursor (the only hover effect on the page) ----
    if (mx != null && amp > 0 && bayZ.length > 1) {
      var R = 130;
      ctx.fillStyle = BLUE;
      for (i = 0; i < bayZ.length - 1; i++) {
        var z0 = bayZ[i], z1 = bayZ[i + 1];
        for (j = 0; j < COL_X.length - 1; j++) {
          var x0 = COL_X[j], x1 = COL_X[j + 1];
          var a = pr(x0, 0, z0), b = pr(x1, 0, z0), c = pr(x1, 0, z1), e = pr(x0, 0, z1);
          if (!a || !b || !c || !e) continue;
          var ccx = (a[0] + b[0] + c[0] + e[0]) / 4;
          var ccy = (a[1] + b[1] + c[1] + e[1]) / 4;
          // perspective makes near tiles enormous, so measure the falloff
          // against the tile's own size — otherwise the tile the cursor is
          // actually standing in barely lights at all
          var rx = Math.max(Math.abs(a[0] - ccx), Math.abs(c[0] - ccx));
          var ry = Math.max(Math.abs(a[1] - ccy), Math.abs(c[1] - ccy));
          var reach = R + Math.sqrt(rx * rx + ry * ry);
          var ddx = ccx - mx, ddy = ccy - my;
          var dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist > reach) continue;
          var t = 1 - dist / reach;
          ctx.globalAlpha = 0.19 * t * t * amp;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- the grid itself, unchanging ----
    ctx.strokeStyle = PALE;
    ctx.lineWidth = WT[2];
    ctx.globalAlpha = 0.24;
    for (i = 0; i < bayZ.length; i++) {
      p1 = pr(xMin, 0, bayZ[i]); p2 = pr(xMax, 0, bayZ[i]);
      if (!p1 || !p2) continue;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    for (i = 0; i < COL_X.length; i++) {
      p1 = pr(COL_X[i], 0, nearZ); p2 = pr(COL_X[i], 0, farZ);
      if (!p1 || !p2) continue;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // joint callouts: a ring at each axis with its number, screen-space so the
  // label stays legible however far down the line the arm is
  function drawJoints(joints, dx, dz, alpha) {
    if (alpha <= 0.02) return;
    for (var i = 0; i < joints.length; i++) {
      var j = joints[i];
      var p = pr(j.p[0] + dx, j.p[1], j.p[2] + dz);
      if (!p) continue;
      var r = Math.max(3, Math.min(9, p[2] * 0.22));
      ctx.globalAlpha = Math.min(0.75, alpha);
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = WT[2];
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p[0] + r, p[1] - r);
      ctx.lineTo(p[0] + r + 12, p[1] - r - 12);
      ctx.stroke();
      ctx.globalAlpha = Math.min(0.7, alpha);
      ctx.fillStyle = SLATE;
      ctx.font = Math.max(8, Math.min(12, p[2] * 0.3)) + 'px "IBM Plex Mono", monospace';
      ctx.textAlign = "left";
      ctx.fillText(j.n, p[0] + r + 15, p[1] - r - 13);
    }
    ctx.globalAlpha = 1;
  }

  // ===== bay stencils =====
  // Corner brackets painted on the floor beside each bay, plus its tag.
  // The brackets are lines, so they project properly; the tag can't be
  // warped, so it is drawn screen-space and scaled by distance.
  function drawStencil(st, ez, fade) {
    if (!st.tag || fade <= 0.01) return;
    var bx = st.side * 4.2, w = 2.6, dep = 3.4;
    var corners = [
      [bx - w, ez - dep], [bx + w, ez - dep],
      [bx + w, ez + dep], [bx - w, ez + dep]
    ];
    ctx.strokeStyle = PALE;
    ctx.lineWidth = WT[2];
    ctx.globalAlpha = 0.3 * fade;
    for (var i = 0; i < 4; i++) {
      var cx = corners[i][0], cz = corners[i][1];
      var ix = cx > bx ? -1.1 : 1.1, iz = cz > ez ? -1.1 : 1.1;
      var o = pr(cx, 0, cz), hx = pr(cx + ix, 0, cz), hz = pr(cx, 0, cz + iz);
      if (!o || !hx || !hz) continue;
      ctx.beginPath();
      ctx.moveTo(hx[0], hx[1]); ctx.lineTo(o[0], o[1]); ctx.lineTo(hz[0], hz[1]);
      ctx.stroke();
    }

    // the tag, screen-space, sized by how far off the bay is. Anchored on
    // the bay's outboard edge so it sits over open floor rather than
    // drifting into the middle of the frame where the copy lives.
    var outboard = st.side < 0 ? bx - w : bx + w;
    var anchor = pr(outboard, 0, ez + dep + 0.9);
    if (anchor) {
      var size = Math.max(6, Math.min(12, anchor[2] * 0.38));
      ctx.globalAlpha = 0.3 * fade;
      ctx.fillStyle = SLATE;
      ctx.font = size + 'px "IBM Plex Mono", monospace';
      ctx.textAlign = st.side < 0 ? "right" : "left";
      ctx.fillText(st.tag, anchor[0], anchor[1]);
      ctx.textAlign = "left";
    }
    ctx.globalAlpha = 1;
  }

  // ===== frame loop =====
  var t0 = 0, lastT = -1, sheetEl = $("#sheet-no"), progEl = $("#progress-fill");

  /* The floor-tile glow belongs to the landing section and nowhere else.
     Switching it off at a hard boundary made it blink, and tracking the raw
     cursor made it stutter, so two things are smoothed: `glowAmp` fades the
     whole effect out as the hero leaves, and the cursor itself is eased
     toward its target instead of jumping tile to tile. */
  var heroEl = $("#hero"), glowAmp = 0, gx = -1, gy = -1;

  function heroShare() {
    if (!heroEl) return 0;
    var r = heroEl.getBoundingClientRect();
    var seen = Math.min(r.bottom, H) - Math.max(r.top, 0);
    if (seen <= 0) return 0;
    return Math.max(0, Math.min(1, seen / Math.min(H, r.height || H)));
  }

  var mouseNX = -1, mouseNY = -1;
  if (!reduced) {
    addEventListener("mousemove", function (e) {
      mouseNX = e.clientX / W; mouseNY = e.clientY / H;
    }, { passive: true });
  }

  // fade the backdrop into the page background along the right edge so it
  // never visually collides with the fixed section nav / title block there
  function fadeEdge(c2) {
    var gutter = mobile ? 0 : Math.min(300, Math.max(220, W * 0.17));
    if (gutter <= 0) return;
    var span = gutter + 120;
    var grad = c2.createLinearGradient(W - span, 0, W, 0);
    grad.addColorStop(0, "rgba(250,248,243,0)");
    grad.addColorStop(1, "rgba(250,248,243,1)");
    c2.fillStyle = grad;
    c2.fillRect(W - span, 0, span, H);
  }

  function frame(now) {
    if (!t0) t0 = now;
    var tt = (now - t0) / 1000;
    var t = scrollT();
    var docH = d.documentElement.scrollHeight - H;
    if (progEl) progEl.style.width = (docH > 0 ? (window.scrollY / docH) * 100 : 0) + "%";

    // walk the camera down the line, easing toward where the scroll is
    camZTarget = scrollCamZ();
    if (reduced) camZ = camZTarget;
    else camZ += (camZTarget - camZ) * 0.08;

    ctx.clearRect(0, 0, cW, cH);

    // ease the glow in and out with the hero, and ease the cursor it follows
    var want = reduced || mouseNX < 0 ? 0 : heroShare();
    glowAmp += (want - glowAmp) * 0.12;
    if (glowAmp < 0.01) {
      glowAmp = 0;
      drawGround(null, null, 0);
    } else {
      var tx = mouseNX * W, ty = mouseNY * H;
      if (gx < 0) { gx = tx; gy = ty; }
      gx += (tx - gx) * 0.18;
      gy += (ty - gy) * 0.18;
      drawGround(gx, gy, glowAmp);
    }

    // the line: only the bays inside the depth window are drawn, so the frame
    // stays sparse however long the line gets. Far to near, so nearer
    // equipment occludes what is behind it. Nothing here reacts to the
    // cursor — the only lift comes from scroll bringing a bay to the front.
    var order = OBJS.slice().sort(function (a, b) { return b.cfg.z - a.cfg.z; });
    for (var k = 0; k < order.length; k++) {
      var o = order[k];
      var ez = o.cfg.z - camZ;
      if (ez < NEAR_CULL || ez > FAR_CULL) continue;

      // fade in as it crests the far edge and out again as it passes by
      var edge = Math.max(0, Math.min(1, (FAR_CULL - ez) / 14, (ez - NEAR_CULL) / 8));
      // and lift a little as scroll brings it to the focal depth
      var focus = Math.max(0, 1 - Math.abs(ez - FOCUS_Z) / 15);
      var baseAlpha = (mobile ? 0.1 : 0.12) * edge;
      var alpha = baseAlpha + (0.24 - baseAlpha) * focus * edge;
      if (alpha <= 0.004) continue;

      drawStencil(o.cfg, ez, edge * (0.45 + 0.55 * focus));

      for (var m = 0; m < o.items.length; m++) {
        var it = o.items[m];
        var iz = ez + it.dz;
        if (iz < 1.5) continue;

        // soft shadow on the floor
        var sc = pr(it.x, 0, iz + 1.2);
        if (sc) {
          var rx = it.def.shadowW * sc[2];
          ctx.globalAlpha = (0.04 + 0.04 * focus) * edge;
          ctx.fillStyle = PALE;
          ctx.beginPath();
          ctx.ellipse(sc[0], sc[1], rx, rx * 0.16, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // `a` lets one marker sit a touch darker than the rest of the line
        var ia = Math.min(0.5, alpha * it.a);
        drawModel(ctx, it.def, pr, { dx: it.x, dz: iz, alpha: ia, df: 1, simple: true });

        // the landing arm has its joints called out, the way a drawing would
        if (o.cfg.joints && it.def.joints) {
          drawJoints(it.def.joints, it.x, iz, ia * 2.4);
        }
      }
    }

    fadeEdge(ctx);

    requestAnimationFrame(frame);
  }

  function modelBBox(model, proj, dx, dz) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, ok = false;
    var parts = model.parts;
    for (var i = 0; i < parts.length; i++) {
      var faces = parts[i].f;
      for (var j = 0; j < faces.length; j++) {
        var pts = faces[j][0];
        for (var k = 0; k < pts.length; k++) {
          var p = proj(pts[k][0] + dx, pts[k][1], pts[k][2] + dz);
          if (!p) continue;
          ok = true;
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        }
      }
    }
    return ok ? { x0: minX, y0: minY, x1: maxX, y1: maxY } : null;
  }

  // ===== reduced motion static render =====
  function renderStatic() {
    camZ = camZTarget = scrollCamZ();
    ctx.clearRect(0, 0, cW, cH);
    drawGround(null, null);
    var order = OBJS.slice().sort(function (a, b) { return b.cfg.z - a.cfg.z; });
    for (var k = 0; k < order.length; k++) {
      var o = order[k];
      var ez = o.cfg.z - camZ;
      if (ez < NEAR_CULL || ez > FAR_CULL) continue;
      var edge = Math.max(0, Math.min(1, (FAR_CULL - ez) / 14, (ez - NEAR_CULL) / 8));
      var focus = Math.max(0, 1 - Math.abs(ez - FOCUS_Z) / 15);
      var baseAlpha = (mobile ? 0.1 : 0.12) * edge;
      var alpha = baseAlpha + (0.24 - baseAlpha) * focus * edge;
      drawStencil(o.cfg, ez, edge * (0.45 + 0.55 * focus));
      for (var m = 0; m < o.items.length; m++) {
        var it = o.items[m];
        var iz = ez + it.dz;
        if (iz < 1.5) continue;
        var sc = pr(it.x, 0, iz + 1.2);
        if (sc) {
          ctx.globalAlpha = 0.04 * edge;
          ctx.fillStyle = PALE;
          ctx.beginPath();
          ctx.ellipse(sc[0], sc[1], it.def.shadowW * sc[2], it.def.shadowW * sc[2] * 0.16, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        var ia = Math.min(0.5, alpha * it.a);
        drawModel(ctx, it.def, pr, { dx: it.x, dz: iz, alpha: ia, df: 1, simple: true });

        // the landing arm has its joints called out, the way a drawing would
        if (o.cfg.joints && it.def.joints) {
          drawJoints(it.def.joints, it.x, iz, ia * 2.4);
        }
      }
    }
    fadeEdge(ctx);
    if (progEl) {
      var docH = d.documentElement.scrollHeight - H;
      progEl.style.width = (docH > 0 ? (window.scrollY / docH) * 100 : 0) + "%";
    }
  }

  // ===== shop floor rows =====
  var ROWS = [
    {
      ind: "Semiconductor Robotics", tag: "RC-101", emp: "Applied Materials", dates: "Jul 2024 to present",
      title: "Robotic platforms, 0 to 1",
      hook: "Among the first robotic platforms for high-mix, low-volume semiconductor fab service.",
      link: null,
      m1: { n: "2", l: "Tier-1 pilots", d: "Running on tool with memory and logic customers." },
      m2: { n: "3", l: "Platforms scoped", d: "Etch, polishing and deposition tools." },
      problem: "Demand for memory and AI chips is surging. Fabs need more service uptime than their teams can supply.",
      brief: "Take a high mix, low volume robotic platform from scope to deployment across etch, polishing and deposition tools.",
      did: "Defined the roadmap and capability stack, wrote the engineering requirements, and mapped the human and robot collaboration journey behind the operator interface. Owned the program proposal and the investment case that secured a Service Robotics Technologies Lab from the Singapore Government EDB.",
      outcome: "$15M+ funding secured, two Tier-1 pilots on tool with memory and logic customers, and a provisional patent on in-tool electrostatic chuck metrology.",
      graph: {
        name: "Service data to field pilot",
        state: "In pilot",
        nodes: [
          { id: "sc", c: 1, r: 2, rs: 2, ic: "db",     t: "Service cases and manuals", s: "10k+ cases" },
          { id: "tm", c: 2, r: 2, rs: 2, ic: "layers", t: "Step-level task model", s: "Python \u00b7 Claude" },
          { id: "sk", c: 3, r: 1, rs: 2, ic: "gear",   t: "Robot skills", s: "Vision and control" },
          { id: "dk", c: 3, r: 3, rs: 2, ic: "bars",   t: "Dashboards and Claude skills", s: "Tableau \u00b7 AI" },
          { id: "rm", c: 4, r: 2, rs: 2, ic: "flag",   t: "Roadmap", s: "Platform strategy" },
          { id: "pr", c: 5, r: 1, rs: 2, ic: "doc",    t: "PRDs and eng requirements", s: "Capability stack" },
          { id: "sw", c: 5, r: 3, rs: 2, ic: "sow",    t: "Aligned SoW", s: "Signed with customer" },
          { id: "fp", c: 6, r: 2, rs: 2, ic: "target", t: "Field pilot on tool", s: "Tier-1 fab" },
          { id: "sp", c: 7, r: 2, rs: 2, ic: "grid",   t: "Scalable platform", s: "Loading", pend: true }
        ],
        edges: [["sc", "tm"],
                ["tm", "sk"], ["tm", "dk"],
                ["sk", "rm"], ["dk", "rm"],
                ["rm", "pr"], ["rm", "sw"],
                ["pr", "fp"], ["sw", "fp"], ["fp", "sp"]]
      },
      tags: ["Platform Scoping", "Requirements & Specs", "Human-Robot Interaction",
             "Roadmap & GTM", "Robot Simulation", "CAD", "Python", "Claude Skills"]
    },
    {
      ind: "Industrial Data Science", tag: "DC-201", emp: "Jio Platforms, Reliance Industries", dates: "Jun to Dec 2022",
      title: "A digital twin of a crude distillation unit",
      hook: "Test a change to a live refinery without touching the refinery.",
      link: null,
      m1: { n: "92%", l: "Prediction accuracy", d: "Against live plant readings, up from 85%." },
      m2: { n: "50+", l: "Sensors integrated", d: "Feeding the twin from across seven unit operations." },
      problem: "Operators could read every instrument on a distillation unit but could not test a change without risking live production.",
      brief: "Simulate the unit from live sensor data, accurately enough to guide operating decisions.",
      did: "Built DWSIM models for each unit operation and ran them across realistic conditions to generate the training data the neural networks needed, since you cannot run a real refinery off-spec to collect it.",
      outcome: "Accuracy up from 85% to 92% against live plant readings, seven unit operations modelled and connected as one plant, and sensor data consistency up 40% after moving the pipeline to Protocol Buffers.",
      graph: {
        name: "Sensor feed to real-time twin",
        state: "Delivered",
        nodes: [
          { id: "sf", c: 1, r: 1, rs: 2, ic: "wave",   t: "Live sensor feed", s: "50+ sensors" },
          { id: "eq", c: 1, r: 3, rs: 2, ic: "chip",   t: "Equipment and streams", s: "Crude distillation" },
          { id: "pb", c: 2, r: 1, rs: 2, ic: "db",     t: "Protocol Buffers", s: "3s latency" },
          { id: "dg", c: 2, r: 3, rs: 2, ic: "grid",   t: "Dependency graph", s: "Execution order" },
          { id: "uo", c: 3, r: 2, rs: 2, ic: "gear",   t: "Unit operation models", s: "DWSIM" },
          { id: "op", c: 4, r: 2, rs: 2, ic: "spark",  t: "Cascaded optimization", s: "Non-linear" },
          { id: "tw", c: 5, r: 2, rs: 2, ic: "layers", t: "Real-time twin", s: "Live mirror" },
          { id: "wi", c: 6, r: 1, rs: 2, ic: "eye",    t: "Operator what-if", s: "Test before change" },
          { id: "vl", c: 6, r: 3, rs: 2, ic: "target", t: "Accuracy against plant", s: "92% on a live unit" }
        ],
        edges: [["sf", "pb"], ["eq", "dg"],
                ["pb", "uo"], ["dg", "uo"],
                ["uo", "op"], ["op", "tw"],
                ["tw", "wi"], ["tw", "vl"]]
      },
      tags: ["Process Simulation", "Synthetic Data Generation", "Model Validation",
             "Digital Twin", "DWSIM", "Protocol Buffers", "Python", "Neural Networks"]
    },
    {
      ind: "Logistics", tag: "TM-301", emp: "WebXpress", dates: "2022 to 2023",
      title: "Making carbon visible in a fleet",
      hook: "You cannot reduce emissions you cannot measure.",
      link: { t: "Live as GreenXpress", u: "https://www.webxpress.ai/platform/greenxpress/" },
      m1: { n: "2", l: "National data integrations", d: "India’s E-way and Vahaan portals." },
      m2: { n: "Live", l: "In production", d: "Shipped and running as GreenXpress." },
      problem: "Logistics companies could not trust their own emissions reporting. Estimated fuel figures and manual route logs left the numbers unusable.",
      brief: "Define a CO₂ tracking product accurate enough to act on, and adoptable by operators with or without a transport management system.",
      did: "Mapped which emissions parameters had to be captured at source against which could be derived, then defined the API integration approach for connecting external operators, including India’s E-way and Vahaan portals.",
      outcome: "Carbon reporting discrepancies down about 30%, integration time down 15% for a pilot client, and manual data entry removed for operators with no TMS.",
      graph: {
        name: "Fleet data to carbon product",
        state: "Live",
        nodes: [
          { id: "er", c: 1, r: 1, rs: 2, ic: "db",     t: "ERP and TMS data", s: "Trip, fuel, vehicle" },
          { id: "pt", c: 1, r: 3, rs: 2, ic: "link",   t: "E-way and Vahaan", s: "Portal integrations" },
          { id: "st", c: 2, r: 2, rs: 2, ic: "layers", t: "Parameter standardisation", s: "Source vs derived" },
          { id: "co", c: 3, r: 2, rs: 2, ic: "bars",   t: "CO2 model", s: "Per trip" },
          { id: "rc", c: 4, r: 1, rs: 2, ic: "spark",  t: "Reduction levers", s: "Route, load, mode" },
          { id: "rp", c: 4, r: 3, rs: 2, ic: "doc",    t: "Emissions reporting", s: "Per trip and per leg" },
          { id: "gx", c: 5, r: 2, rs: 2, ic: "target", t: "GreenXpress", s: "Live product" }
        ],
        edges: [["er", "st"], ["pt", "st"], ["st", "co"],
                ["co", "rc"], ["co", "rp"],
                ["rc", "gx"], ["rp", "gx"]]
      },
      tags: ["Product Requirements", "Systems Integration", "Data Modelling",
             "Sustainability Reporting", "API Design"]
    },
    {
      ind: "Public Infrastructure", tag: "FL-401", emp: "Town of Ithaca", dates: "Jan to May 2024",
      title: "Knowing when to replace the asset",
      hook: "How long a town should keep its vehicles before replacing them, and whether to buy or lease.",
      link: null,
      m1: { n: "50%", l: "Longer service life", d: "Fifteen years rather than the standard ten." },
      m2: { n: "100+", l: "Asset fleet", d: "Vehicles and equipment across the town." },
      problem: "An aging public fleet with no evidence base for replacement timing, against a 2030 carbon neutrality commitment.",
      brief: "Establish defensible service life by asset class, assess lease versus purchase, and test the green fleet policy.",
      did: "Led the client engagement from scoping to final presentation, and built the cost of ownership and annualized cost models that found where maintenance overtakes asset value.",
      outcome: "A 15 year service life adopted over the standard 10, purchase over lease given low annual mileage, and a replacement tool the town now uses for fleet decisions.",
      graph: {
        name: "Fleet inventory to replacement policy",
        state: "Presented",
        nodes: [
          { id: "fi", c: 1, r: 1, rs: 2, ic: "db",     t: "Fleet inventory", s: "100+ assets" },
          { id: "cs", c: 1, r: 3, rs: 2, ic: "bars",   t: "Cost and maintenance history", s: "Per asset" },
          { id: "lc", c: 2, r: 2, rs: 2, ic: "gear",   t: "Life cycle cost model", s: "ACO and EUAC" },
          { id: "cy", c: 3, r: 1, rs: 2, ic: "layers", t: "Cash flow by cycle", s: "10, 15, 20 years" },
          { id: "lp", c: 3, r: 3, rs: 2, ic: "brief",  t: "Lease versus purchase", s: "Low annual mileage" },
          { id: "gp", c: 4, r: 2, rs: 2, ic: "spark",  t: "Green fleet scenarios", s: "Duty and winter" },
          { id: "rc", c: 5, r: 2, rs: 2, ic: "flag",   t: "Committee recommendation", s: "15 year life" }
        ],
        edges: [["fi", "lc"], ["cs", "lc"],
                ["lc", "cy"], ["lc", "lp"],
                ["cy", "gp"], ["lp", "gp"], ["gp", "rc"]]
      },
      tags: ["Life Cycle Cost Analysis", "Engineering Economics", "Stakeholder Management",
             "Decision Modelling", "SQL", "Excel", "Tableau"]
    },
    {
      ind: "Reliability Engineering", tag: "BR-501", emp: "IIT Goa", dates: "Jan to Apr 2023",
      title: "Estimating what\u2019s left of a machine\u2019s life",
      hook: "A maintenance prediction nobody can schedule against is worthless.",
      link: { t: "Springer chapter", u: "https://link.springer.com/chapter/10.1007/978-3-031-55048-5_11" },
      m1: { n: "35\u201340%", l: "Lower prediction error", d: "Beating traditional pipelines by a further 2 to 4%." },
      m2: { n: "First author", l: "Peer-reviewed Springer chapter", d: "Turbofan engines, bearings and solar cells, all modelled." },
      problem: "Reactive maintenance catches failures only after they happen, risking equipment and sometimes lives.",
      brief: null,
      did: "Built fault detection and remaining useful life models across three unrelated components, using particle swarm feature selection with custom objectives rather than reaching for larger models.",
      outcome: "Prediction error cut 35\u201340%, beating traditional pipelines by 2 to 4%, across turbofan engines, bearings and solar cells, published as a first-author peer-reviewed Springer chapter.",
      graph: {
        name: "Sensor history to published model",
        state: "Published",
        nodes: [
          { id: "sh", c: 1, r: 2, rs: 2, ic: "wave",   t: "Sensor histories", s: "Run to failure" },
          { id: "fs", c: 2, r: 2, rs: 2, ic: "spark",  t: "PSO feature selection", s: "Custom objectives" },
          { id: "fd", c: 3, r: 1, rs: 2, ic: "eye",    t: "Fault detection", s: "Failure modes" },
          { id: "rl", c: 3, r: 3, rs: 2, ic: "bars",   t: "Remaining useful life", s: "Regression" },
          { id: "vl", c: 4, r: 2, rs: 2, ic: "target", t: "Cross-asset validation", s: "Three asset types" },
          { id: "pb", c: 5, r: 2, rs: 2, ic: "doc",    t: "Springer chapter", s: "Peer reviewed" }
        ],
        edges: [["sh", "fs"],
                ["fs", "fd"], ["fs", "rl"],
                ["fd", "vl"], ["rl", "vl"],
                ["vl", "pb"]]
      },
      tags: ["Predictive Maintenance", "Machine Learning", "Feature Engineering",
             "Technical Writing", "Particle Swarm Optimization", "Python"]
    },
    {
      ind: "Additive Manufacturing", tag: "AM-601", emp: "NYU IRES", dates: "Jun to Aug 2021",
      title: "Detecting tampered G-code",
      hook: "Sabotage a print file and the part fails in the field, not on the bench.",
      link: { t: "arXiv \u00B7 IEEE Embedded Systems Letters", u: "https://arxiv.org/abs/2111.12746" },
      m1: { n: "~83%", l: "Attack detection coverage", d: "Across six attack methods, tested blind." },
      m2: { n: "4,000+", l: "Control files", d: "More manufacturing control files than anyone can inspect by hand." },
      problem: "G-code is an intermediate machine format, so malicious edits are nearly invisible when the manufacturer never sees the original CAD model.",
      brief: "Quantify whether subtle tampering in machine-level data can be detected at all, at a scale no one can inspect by hand.",
      did: "Built ML anomaly detection pipelines across 4,000+ manufacturing control files, benchmarked unsupervised against statistical methods, and analysed precision-recall and false-positive trade-offs to guide deployment decisions.",
      outcome: "About 83% attack detection coverage, published in IEEE Embedded Systems Letters in 2022, NSF funded through NYU’s International Research Experience for Students, and 2nd place in Hack3D.",
      graph: {
        name: "Design set to published detector",
        state: "Published",
        nodes: [
          { id: "gc", c: 1, r: 2, rs: 2, ic: "grid",   t: "G-code design sets", s: "4,000+ files" },
          { id: "fe", c: 2, r: 2, rs: 2, ic: "layers", t: "Feature extraction", s: "No golden models" },
          { id: "pc", c: 3, r: 1, rs: 2, ic: "spark",  t: "PCA and clustering", s: "Unsupervised" },
          { id: "sm", c: 3, r: 3, rs: 2, ic: "gear",   t: "Statistical and ML models", s: "Six attack types" },
          { id: "dt", c: 4, r: 2, rs: 2, ic: "eye",    t: "Anomaly detector", s: "~83% coverage" },
          { id: "h3", c: 5, r: 1, rs: 2, ic: "target", t: "Hack3D blue team", s: "2nd place" },
          { id: "pb", c: 5, r: 3, rs: 2, ic: "doc",    t: "IEEE ESL paper", s: "Peer reviewed" }
        ],
        edges: [["gc", "fe"],
                ["fe", "pc"], ["fe", "sm"],
                ["pc", "dt"], ["sm", "dt"],
                ["dt", "h3"], ["dt", "pb"]]
      },
      tags: ["Anomaly Detection", "Machine Learning", "Research & Publication",
             "Manufacturing Security", "PCA", "Python"]
    }
  ];

  // ===== the record of service =====
  // Taken from the resume itself, in the order the resume puts things: the
  // professional posts first, newest role at the top of each, then the
  // engineering projects. Relevance, not a strict run of dates.
  var CV = [
    { grp: "Professional experience", org: "Applied Materials", loc: "Santa Clara, CA", row: 0,
      scope: "Service Robotics \u00b7 Cobot platform \u00b7 Semiconductor fab",
      sel: "Capability stack \u00b7 Platform GUI \u00b7 Service-case dashboard \u00b7 EDB lab proposal \u00b7 ESC metrology patent",
      roles: [
        { t: "Sr. Product Manager (III) \u2014 Robotics", when: "Jan 2026 \u2014 present",
          m: [{ n: "1+", l: "Robotic embodiments scoped" },
              { n: "2", l: "Tier-1 pilots" },
              { n: "3", l: "Platforms scoped" }],
          b: [
            "Building one of the industry firsts cobot platform 0 to 1: roadmap, use case prioritisation and pilot execution",
            "Defined the capability stack across robotics, computer vision and end-of-arm tooling, then scoped the platform HMI and its data pipeline integration",
            "Strategizing engagements with Tier-1 memory and logic customers, turning critical use cases into roadmap priorities",
            "Designing the GTM and value model, validated through pilot deployments"
          ] },
        { t: "Product Manager (II) \u2014 Robotics", when: "Jul 2024 \u2014 Dec 2025",
          m: [{ n: "$15M+", l: "Government funding secured" },
              { n: "8h \u2192 15min", l: "Service review per case" },
              { n: "100+", l: "Users on the dashboard" }],
          b: [
            "Defining and tracking a backlog of 20+ platform features, connecting roadmap initiatives to execution",
            "Owned the program proposal that secured a Service Robotics Technologies Lab from the Singapore Government EDB",
            "Built the service-case dashboard and Claude skills over the case data, surfacing the high-ROI automation opportunities",
            "Co-developed a provisional patent for measuring electrostatic chuck degradation on the Etch product line"
          ] }
      ] },
    { grp: "Professional experience", org: "WebXpress", sub: "Logistics SaaS", loc: "Mumbai, India", row: 2,
      scope: "GreenXpress \u00b7 Carbon intelligence \u00b7 ERP and TMS integration",
      sel: "PRD and integration architecture \u00b7 CO\u2082 model \u00b7 Route and load recommendations",
      roles: [
        { t: "Product Management Intern", when: "Jan \u2014 Apr 2023",
          m: [{ n: "~30%", l: "Fewer reporting discrepancies" },
              { n: "2", l: "National data integrations" }],
          b: [
            "Defined the PRD and integration architecture for GreenXpress, standardising trip, fuel and vehicle data across ERP and TMS systems",
            "Designed the reporting and recommendation workflows tying CO\u2082 measurement to the levers that move it: fuel, routing and load utilisation"
          ] }
      ] },
    { grp: "Professional experience", org: "Jio Platforms, Reliance Industries", loc: "Mumbai, India", row: 1,
      scope: "AI Center of Excellence \u00b7 Digital twin \u00b7 Industrial IoT",
      sel: "Refinery simulation \u00b7 Equipment graph \u00b7 Protocol Buffers pipeline \u00b7 Platform KPIs",
      roles: [
        { t: "Industrial Data Science Intern", when: "Jun \u2014 Dec 2022",
          m: [{ n: "92%", l: "Prediction accuracy" },
              { n: "50+", l: "Sensors integrated" },
              { n: "40%", l: "Better data consistency" }],
          b: [
            "Built a digital twin of refinery operations in Python on live IoT data, simulating the process in real time",
            "Prototyped and validated a new product introduction workflow with ML models, Python simulations and APIs, moving the sensor pipeline to Protocol Buffers",
            "Defined the KPIs for the platform, mapping model performance onto business OKRs"
          ] }
      ] },
    { grp: "Engineering projects", org: "IIT Goa", loc: "Goa, India", row: 4,
      scope: "Predictive maintenance \u00b7 Remaining useful life \u00b7 Feature selection",
      sel: "Fault detection \u00b7 RUL models \u00b7 Particle swarm feature selection \u00b7 Springer chapter",
      roles: [
        { t: "AI/ML Research Intern", when: "Jan \u2014 Apr 2023",
          m: [{ n: "35\u201340%", l: "Lower prediction error" },
              { n: "2\u20134%", l: "Better than traditional pipelines" }],
          b: [
            "Built predictive-maintenance prototypes for fault detection and remaining useful life estimation",
            "Cut prediction error with particle swarm feature selection on custom objectives",
            "First-authored a peer-reviewed chapter on scalable ML for predictive maintenance"
          ] }
      ] },
    { grp: "Engineering projects", org: "NYU IRES", loc: "Remote", row: 5,
      scope: "Additive manufacturing security \u00b7 Anomaly detection \u00b7 NSF funded",
      sel: "G-code datasets \u00b7 Feature extraction \u00b7 PCA and clustering \u00b7 Hack3D",
      roles: [
        { t: "ML in Additive Manufacturing \u2014 Researcher", when: "Jun \u2014 Aug 2021",
          m: [{ n: "~83%", l: "Attack detection coverage" },
              { n: "4,000+", l: "Control files analysed" }],
          b: [
            "Built anomaly-detection pipelines over manufacturing control files, modelling how tampering shows up in machine-level data",
            "Benchmarked unsupervised and statistical methods, weighing precision against false positives so the detector would survive deployment"
          ] }
      ] }
  ];

  var SCHOOLS = [
    { org: "Cornell University", loc: "Ithaca, NY", when: "May 2024",
      deg: "M.Eng, Engineering and Industrial Management",
      hon: "GPA 4.221 \u00b7 Degree Marshal, first across the M.Eng programs" },
    { org: "Indian Institute of Technology, Goa", loc: "Goa, India", when: "May 2023",
      deg: "B.Tech, Mechanical Engineering",
      hon: "GPA 9.15 / 10 \u00b7 Institute Bronze Medalist" }
  ];

  // her own list, not one derived from the project tags
  var SKILLS = [
    "Python", "AI prototyping", "Agile product management",
    "Feature prioritisation and roadmapping", "Six Sigma principles",
    "Market research", "Predictive maintenance", "RoboDK simulation",
    "PLC programming", "SolidWorks"
  ];

  var PAPERS = [
    { t: "Scalable ML approaches for predictive maintenance",
      w: "Chapter in Exploration of Reliability Engineering for Industrial Processes: An Analytics Perspective, Springer Series in Reliability Engineering. First author.",
      y: "2024", u: "https://link.springer.com/chapter/10.1007/978-3-031-55048-5_11" },
    { t: "Needle in a Haystack: detecting subtle malicious edits to additive manufacturing G-code files",
      w: "IEEE Embedded Systems Letters. NSF funded through NYU\u2019s International Research Experience for Students.",
      y: "2022", u: "https://arxiv.org/abs/2111.12746" },
    { t: "Robotic system for measuring electrostatic chuck degradation",
      w: "Provisional patent, co-developed on the Etch product line. Computer vision and sensing integrated with the robot, measuring inside the tool.",
      y: "Filed", u: "" }
  ];

  // ===== section C: the work track =====
  // Projects sit on a horizontal track. The one nearest the centre of the
  // track opens; the rest stay as spines. Nothing to click to read it.
  function cardBody(r, i) {
    return '<div class="pc-body">' +
      (r.link ? '<a class="rp-link" href="' + r.link.u + '" target="_blank" rel="noopener" data-testid="row-link-' + (i + 1) + '"><span class="arr">&searr;</span> ' + r.link.t + '</a>' : '') +
      flowRow(r, "work-" + (i + 1)) +
      '<div class="datasheet">' +
        dsRows(r) +
      '</div>' +
    '</div>';
  }

  // the four written sections of a record, in the order they are read:
  // a spec table, label in the stub column, one sentence against it
  function dsRows(r) {
    function row(label, body) {
      if (!body) return "";
      return '<div class="ds-row"><p class="ds-label">' + label + '</p>' +
             '<p class="ds-body">' + body + '</p></div>';
    }
    return row("The problem", r.problem) +
           row("The brief", r.brief) +
           row("What I did", r.did) +
           row("The outcome", r.outcome);
  }

  // Plain line glyphs, the vocabulary a node editor uses: a chip, a document,
  // layers, an eye, a gear, bars, a sparkle, a checklist, a circled check.
  var GR_ICONS = {
    chip: 'M6 6h12v12H6z M10 10h4v4h-4z M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
    doc: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z M14 3v4h4 M9 12h6M9 16h5',
    layers: 'M12 3 3 7.5 12 12l9-4.5L12 3z M3 12l9 4.5L21 12 M3 16.5 12 21l9-4.5',
    eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
    gear: 'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9',
    bars: 'M3 21h18 M7 21v-6.5M12 21V7.5M17 21v-10',
    db: 'M12 3c-3.9 0-7 1.1-7 2.5S8.1 8 12 8s7-1.1 7-2.5S15.9 3 12 3z M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6 M5 11.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6',
    flag: 'M6 21V4 M6 4.5h11.5l-2.4 3.6 2.4 3.6H6',
    sow: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z M14 3v4h4 M9 11h6 M8.8 16.4c1.1-1.5 1.9-1.5 2.6 0 .7 1.5 1.5 1.5 2.6 0',
    grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    wave: 'M2 12h3l2.5-6.5L12 19l3-10 2 6h5',
    link: 'M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.1 1.1 M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.1-1.1',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z M18.5 15.2l.8 2.1 2.2.8-2.2.8-.8 2.1-.8-2.1-2.2-.8 2.2-.8z',
    list: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z M14 3v4h4 M8.6 12.6l1.4 1.4 2.8-2.8 M8.6 17l1.4 1.4 2.8-2.8',
    target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z M12 1.4v3.2M12 19.4v3.2M1.4 12h3.2M19.4 12h3.2'
  };

  // A record whose run actually branched gets drawn as a graph rather than a
  // line: sources on the left, a wire for every dependency, nodes where the
  // work forked. The wires are measured from the laid-out nodes, so the
  // drawing survives any width.
  function graphRow(r, where) {
    var g = r.graph, h = "", cols = 1, rows = 1;
    for (var k = 0; k < g.nodes.length; k++) {
      cols = Math.max(cols, g.nodes[k].c);
      rows = Math.max(rows, g.nodes[k].r + (g.nodes[k].rs || 1) - 1);
    }
    h += '<div class="pk-graph" data-testid="' + where + '-flow" role="img" aria-label="Workflow: ' +
      g.nodes.map(function (n) { return n.t; }).join(", ") + '">' +
      '<div class="gr-head">' +
        '<p class="gr-cap">Example workflow &nbsp;&middot;&nbsp; ' + g.name + '</p>' +
        '<span class="gr-state">' + (g.state || "Shipped") + '</span>' +
      '</div>' +
      '<svg class="gr-wires" aria-hidden="true"></svg>' +
      '<div class="gr-grid" style="--cols:' + cols + ';--rows:' + rows + '" data-edges="' +
        g.edges.map(function (e) { return e.join(">"); }).join(",") + '">';
    for (var i = 0; i < g.nodes.length; i++) {
      var n = g.nodes[i];
      h += '<div class="gr-node' + (n.pend ? " is-pend" : "") + '" data-id="' + n.id + '" style="--c:' + n.c +
             ';--r:' + n.r + ';--rs:' + (n.rs || 1) + '">' +
             '<span class="gr-tile">' +
               '<svg class="gr-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' +
                 (GR_ICONS[n.ic] || GR_ICONS.chip) + '"/></svg>' +
             '</span>' +
             '<b>' + n.t + '</b>' +
             (n.s ? '<em>' + n.s + '</em>' : '') +
           '</div>';
    }
    return h + '</div></div>';
  }

  // the wires, measured off the nodes once they have a width
  function drawWires(host) {
    var svg = host.querySelector(".gr-wires");
    var grid = host.querySelector(".gr-grid");
    if (!svg || !grid) return;
    var w = host.clientWidth;
    if (!w) return;
    /* squeezed, the graph stays a graph and gets smaller; only when a column
       would be too narrow to read does it fall back to one stacked run */
    var cols = parseInt(grid.style.getPropertyValue("--cols"), 10) || 7;
    var per = w / cols;
    host.classList.toggle("gr-tight", per < 132 && per >= 58);
    host.classList.toggle("gr-micro", per < 80 && per >= 58);
    host.classList.toggle("gr-stack", per < 58);
    var ht = host.clientHeight;
    if (getComputedStyle(svg).display === "none") { svg.innerHTML = ""; return; }
    svg.setAttribute("viewBox", "0 0 " + w + " " + ht);
    var by = {};
    var nodes = grid.querySelectorAll(".gr-node");
    for (var i = 0; i < nodes.length; i++) by[nodes[i].getAttribute("data-id")] = nodes[i];
    var edges = (grid.getAttribute("data-edges") || "").split(",");
    /* measured against the host box, so it does not matter which ancestor
       happens to be the offset parent */
    var hr = host.getBoundingClientRect();
    var line = "", head = "", dots = {};
    for (var j = 0; j < edges.length; j++) {
      var p = edges[j].split(">"), a = by[p[0]], b = by[p[1]];
      if (!a || !b) continue;
      var ar = (a.querySelector(".gr-tile") || a).getBoundingClientRect();
      var br = (b.querySelector(".gr-tile") || b).getBoundingClientRect();
      var x1 = ar.right - hr.left, y1 = ar.top - hr.top + ar.height / 2;
      var x2 = br.left - hr.left, y2 = br.top - hr.top + br.height / 2;
      var k = Math.max(16, (x2 - x1) * 0.55);
      line += "M" + x1 + " " + y1 + "C" + (x1 + k) + " " + y1 + "," +
              (x2 - k) + " " + y2 + "," + x2 + " " + y2;
      head += "M" + (x2 - 6) + " " + (y2 - 3.6) + "L" + x2 + " " + y2 +
              "L" + (x2 - 6) + " " + (y2 + 3.6);
      dots[Math.round(x1) + ":" + Math.round(y1)] = 1;
      dots[Math.round(x2) + ":" + Math.round(y2)] = 1;
    }
    var pins = Object.keys(dots).map(function (p) {
      var xy = p.split(":");
      return '<circle class="gw-pin" cx="' + xy[0] + '" cy="' + xy[1] + '" r="3.4"/>';
    }).join("");
    svg.innerHTML = '<path class="gw-line" d="' + line + '"/>' +
                    '<path class="gw-dash" d="' + line + '"/>' +
                    '<path class="gw-head" d="' + head + '"/>' + pins;
  }

  function initGraphs(root) {
    var gs = (root || document).querySelectorAll(".pk-graph");
    for (var i = 0; i < gs.length; i++) {
      (function (g) {
        drawWires(g);
        if (window.ResizeObserver) new ResizeObserver(function () { drawWires(g); }).observe(g);
      })(gs[i]);
    }
  }

  function flowRow(r, where) {
    if (r.graph) return graphRow(r, where);
    if (!r.flow || !r.flow.length) return "";
    var h = '<div class="pk-flow" data-testid="' + where + '-flow" role="img" aria-label="Stages: ' +
      r.flow.join(", ") + '">';
    for (var i = 0; i < r.flow.length; i++) {
      if (i) h += '<span class="fl-run" aria-hidden="true"></span>';
      h += '<span class="fl-step"><i>' + ("0" + (i + 1)) + '</i>' + r.flow[i] + '</span>';
    }
    return h + '</div>';
  }

  function tagRow(r, extra) {
    return '<div class="tags' + (extra ? " " + extra : "") + '">' +
      r.tags.map(function (t) {
        return '<span class="tag">' + wkEsc(t) + '</span>';
      }).join("") +
    '</div>';
  }

  // one figure on the card face, with the derivation it is owed behind an i
  function wcFig(m, i, n) {
    return '<div class="metric wc-metric" data-testid="metric-' + (i + 1) + '-' + n + '">' +
      '<p class="wc-impact">' + m.n + '</p>' +
      '<p class="wc-cap">' + m.l +
        '<button class="mi" data-testid="metric-toggle-' + (i + 1) + '-' + n + '" aria-label="Derivation">i</button></p>' +
      '<p class="deriv" data-testid="derivation-' + (i + 1) + '-' + n + '">' + m.d + '</p>' +
    '</div>';
  }

  function renderStack() {
    var host = $("#work-stack");
    if (!host) return;
    var html = "";
    for (var i = 0; i < ROWS.length; i++) {
      var r = ROWS[i];
      html += '<article class="wcard" data-i="' + i + '" data-testid="work-card-' + (i + 1) + '">' +
        '<div class="wc-face">' +
          '<div class="wc-top">' +
            '<span class="wc-co">' + r.emp + '</span>' +
            '<span class="wc-arr" aria-hidden="true">+</span>' +
          '</div>' +
          '<p class="pc-ind">' + r.ind + ' &middot; <span class="rh-tag">' + r.tag + '</span></p>' +
          '<h2 class="wc-title">' + r.title + '</h2>' +
          '<p class="wc-hook">' + r.hook + '</p>' +
        '</div>' +
        '<div class="wc-foot">' +
          '<div class="wc-figs">' + wcFig(r.m1, i, 1) + wcFig(r.m2, i, 2) + '</div>' +
          '<p class="wc-dates">' + r.dates + '</p>' +
          tagRow(r) +
        '</div>' +
        cardBody(r, i) +
      '</article>';
    }
    host.innerHTML = html;
    initGraphs(host);
  }

  function bindStack() {
    var host = $("#work-stack");
    if (!host) return;
    var cards = Array.prototype.slice.call(host.querySelectorAll(".wcard"));

    // the grid is the reading layer; a card opens in place so the page never
    // has to navigate anywhere to show the detail behind a number
    cards.forEach(function (c) {
      var btn = c.querySelector(".wc-arr");
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", "0");
      c.setAttribute("aria-expanded", "false");

      function toggle() {
        var open = c.classList.toggle("open");
        host.classList.toggle("has-open", open);
        c.setAttribute("aria-expanded", open ? "true" : "false");
        if (btn) btn.textContent = open ? "\u2212" : "+";
        if (open) {
          var shutting = false;
          cards.forEach(function (o) {
            if (o === c) return;
            if (o.classList.contains("open")) shutting = true;
            o.classList.remove("open");
            o.setAttribute("aria-expanded", "false");
            var ob = o.querySelector(".wc-arr");
            if (ob) ob.textContent = "+";
          });
          // The card now spans the sheet, so the grid reflows around it and it
          // can end up above the top of the screen. A card shutting at the same
          // time keeps moving for the length of its collapse, so the position
          // is only worth reading once that has finished.
          setTimeout(function () {
            var t = c.getBoundingClientRect().top;
            if (t < 70 || t > innerHeight * 0.6) {
              scrollTo({ top: scrollY + t - 90, behavior: reduced ? "auto" : "smooth" });
            }
          }, shutting && !reduced ? 580 : 16);
        }
      }

      c.addEventListener("click", function (e) {
        // links inside the detail still behave like links
        if (e.target.closest("a") || e.target.closest(".mi")) return;
        toggle();
      });
      c.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    });
  }

  /* ===== section E — lately, on a belt ===== */
  var BELT_ITEMS = [
    { k: "Writing and community", n: "The Ground Truth", img: "img/ground-truth.png", fit: "logo",
      l: "Every week we take one piece of deep tech apart and write up the science, the money and the people behind it.",
      cap: "What each issue takes apart", arch: [{ ic: "eye", t: "Pick the week&rsquo;s story" }, { ic: "doc", t: "Read the science" }, { ic: "bars", t: "Follow the money" }, { ic: "flag", t: "Publish on Substack" }],
      sk: ["Technical writing", "Research", "Editorial judgement", "Audience growth"],
      ls: [{ t: "Substack", u: "https://asthegroundtruth.substack.com" }] },
    { k: "Writing and community", n: "Girls Into VC", img: "img/girls-into-vc.png", fit: "logo",
      l: "A global community getting young women into venture, where I learn the business from people already doing it.",
      cap: "What I am learning there", arch: [{ ic: "grid", t: "How a fund is built" }, { ic: "eye", t: "Diligence on a deal" }, { ic: "doc", t: "Terms and ownership" }, { ic: "link", t: "The people already doing it" }],
      sk: ["Venture diligence", "Market mapping", "Community building"],
      ls: [{ t: "girlsintovc", u: "https://girlsintovc.beehiiv.com" }] },
    { k: "AI tinkering", n: "HerLabs", img: "img/herlabs.jpg",
      l: "Reads your lab report back in plain English, so you know what it says before you sit down with the doctor.",
      cap: "What it is built on", arch: [{ ic: "doc", t: "PDF parsed to typed values" }, { ic: "db", t: "Grounded in reference ranges" }, { ic: "grid", t: "Schema-constrained output" }, { ic: "eye", t: "Guardrails: explain, never diagnose" }],
      sk: ["Retrieval grounding", "Structured output", "Prompt guardrails", "Lovable"],
      ls: [{ t: "Try it", u: "https://health-her-insight.lovable.app/" }] },
    { k: "AI tinkering", n: "Hidden Gems", img: "img/hidden-gems.jpg",
      l: "Finds the coffee shops worth the walk, ranked on what you actually want rather than on who has the most reviews.",
      cap: "What it is built on", arch: [{ ic: "db", t: "Reviews embedded, not counted" }, { ic: "gear", t: "Taste written as a query" }, { ic: "bars", t: "Semantic match over star average" }, { ic: "target", t: "Re-ranked on stated intent" }],
      sk: ["Embeddings", "Semantic search", "Re-ranking", "Vercel"],
      ls: [{ t: "Try it", u: "https://hidden-gems-wine.vercel.app/" }] },
    { k: "AI tinkering", n: "GroupTrip", img: "img/grouptrip-pitch.jpg",
      l: "Turns a group chat full of half-made plans into one itinerary everybody can live with. Built and pitched at the mem0 buildathon.",
      cap: "What it is built on", arch: [{ ic: "link", t: "Chat parsed into preferences" }, { ic: "db", t: "Per-person memory that persists" }, { ic: "spark", t: "Agent resolves the conflicts" }, { ic: "grid", t: "Itinerary as structured output" }],
      sk: ["Agent memory", "mem0", "Constraint resolution", "Structured output"],
      ls: [{ t: "Try it", u: "https://buildathon-mem0.vercel.app/" }] },
    { k: "Robotic simulation", n: "MuJoCo simulation", img: "img/mujoco.jpg",
      l: "Robot arms run in simulation, so a bad motion fails in physics instead of on real hardware.",
      cap: "What it is built on", arch: [{ ic: "chip", t: "Scene and robot in MJCF" }, { ic: "gear", t: "Contact-rich physics step" }, { ic: "layers", t: "Inverse kinematics to joint targets" }, { ic: "eye", t: "Rollouts before hardware" }],
      sk: ["MuJoCo", "Inverse kinematics", "Contact dynamics", "Python"],
      ls: [{ t: "MuJoCo Menagerie", u: "https://github.com/google-deepmind/mujoco_menagerie" }] }
  ];

  function renderBelt() {
    var belt = $("#belt");
    if (!belt) return;
    function card(it, i, copy) {
      var ls = (it.ls || []).map(function (l) {
        return '<a class="bc-link" href="' + l.u + '" target="_blank" rel="noopener">' +
          l.t + ' <span class="arr" aria-hidden="true">&nearr;</span></a>';
      }).join("");
      // an empty frame until the picture exists, so the card keeps its shape
      // and it is obvious where one goes rather than quietly having none
      var pic = it.img
        ? '<img class="bc-pic' + (it.fit === "logo" ? ' bc-pic-logo' : '') +
          '" src="' + it.img + '" alt="" loading="lazy" />'
        : '<span class="bc-pic bc-pic-empty" aria-hidden="true"></span>';
      // the back: the run drawn as a short flow, then what it taught, in
      // chips a size under the ones the work section uses
      var steps = (it.arch || []).map(function (s) {
        return '<li class="bb-step">' +
          '<span class="bb-tile"><svg class="bb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' +
            (GR_ICONS[s.ic] || GR_ICONS.chip) + '"/></svg></span>' +
          '<b>' + s.t + '</b>' +
        '</li>';
      }).join("");
      var sk = (it.sk || []).map(function (s) {
        return '<span class="bb-sk">' + s + '</span>';
      }).join("");
      return '<article class="bcard" role="listitem" data-testid="belt-card-' + copy + '-' + (i + 1) + '">' +
        '<div class="bc-flip">' +
          '<div class="bc-face bc-front">' +
            pic +
            '<div class="bc-txt">' +
              '<p class="bc-k">' + it.k + '</p>' +
              '<p class="bc-name">' + it.n + '</p>' +
              '<p class="bc-line">' + it.l + '</p>' +
              (ls ? '<div class="bc-links">' + ls + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="bc-face bc-back" data-testid="belt-back-' + copy + '-' + (i + 1) + '">' +
            '<p class="bb-cap">' + (it.cap || "How it works") + '</p>' +
            '<ol class="bb-flow">' + steps + '</ol>' +
            (sk ? '<div class="bb-sks">' + sk + '</div>' : '') +
            (ls ? '<div class="bc-links bb-links">' + ls + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</article>';
    }
    var html = "";
    // two copies back to back, so the belt can loop without a seam
    for (var c = 0; c < 2; c++) {
      for (var i = 0; i < BELT_ITEMS.length; i++) html += card(BELT_ITEMS[i], i, c + 1);
    }
    belt.innerHTML = html;
  }

  function bindBelt() {
    var belt = $("#belt"), wrap = belt && belt.closest(".belt-wrap");
    if (!belt || !wrap) return;
    var cards = Array.prototype.slice.call(belt.querySelectorAll(".bcard"));
    if (!cards.length) return;
    if (reduced) return;

    // The belt simply runs. Nothing is singled out and nothing is held: every
    // card is readable the whole way across, and the reader can push it along
    // by hand, by trackpad or by swipe at any point.
    var SPEED = 74, span = 0, off = 0, last = null,
        paused = false, running = false, raf = 0,
        dragging = false, dragFrom = 0, dragOff = 0, dragged = 0, wheelIdle = 0;

    function recalc() {
      // one copy's worth of travel, so the second copy always covers the seam
      var mids = cards.map(function (c) { return c.offsetLeft + c.offsetWidth / 2; });
      span = mids.length > 1 ? mids[mids.length / 2] - mids[0] : belt.scrollWidth / 2;
    }

    function place(v) {
      if (span > 0) { v %= span; if (v < 0) v += span; }
      off = v;
      belt.style.transform = "translate3d(" + (-off) + "px,0,0)";
    }

    function tick(now) {
      if (!running) return;
      if (last === null) last = now;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!paused && !dragging && now > wheelIdle) place(off + SPEED * dt);
      raf = requestAnimationFrame(tick);
    }

    function start() { if (running) return; running = true; last = null; raf = requestAnimationFrame(tick); }
    function stop() { running = false; cancelAnimationFrame(raf); }

    // Drag or swipe the belt along by hand. The pointer is captured so a
    // gesture that starts here finishes here, and touch-action keeps the
    // vertical gesture with the page while the horizontal one comes to us.
    wrap.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      dragging = true; dragged = 0;
      dragFrom = e.clientX; dragOff = off;
      wrap.classList.add("dragging");
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    });

    wrap.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - dragFrom;
      if (Math.abs(dx) > dragged) dragged = Math.abs(dx);
      place(dragOff - dx);
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      last = null;
      wrap.classList.remove("dragging");
      try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", endDrag);

    // A sideways trackpad gesture, or shift and the wheel, scrolls the belt.
    // A plain vertical wheel is left alone so the page still scrolls past.
    wrap.addEventListener("wheel", function (e) {
      var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX
             : (e.shiftKey ? e.deltaY : 0);
      if (!dx) return;
      e.preventDefault();
      place(off + dx);
      // let the gesture finish before the belt takes over again
      wheelIdle = performance.now() + 400;
      last = null;
    }, { passive: false });

    // a drag that happened to start on a link is a drag, not a click
    wrap.addEventListener("click", function (e) {
      if (dragged > 6) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // the belt holds still while it is being pointed at or tabbed through, so
    // a link on a card can actually be clicked
    wrap.addEventListener("pointerenter", function () { paused = true; });
    wrap.addEventListener("pointerleave", function () { if (!dragging) { paused = false; last = null; } });
    wrap.addEventListener("focusin", function () { paused = true; });
    wrap.addEventListener("focusout", function () { paused = false; last = null; });

    addEventListener("resize", function () { recalc(); });
    recalc();

    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { start(); } else { stop(); }
      }, { threshold: 0 }).observe(wrap);
    } else {
      start();
    }
  }

  /* ===== nav: which section is being read ===== */
  var SPY = ["hero", "blueprint", "route", "shop-floor", "off-shift", "on-call"];
  function initSpy() {
    var links = {};
    Array.prototype.slice.call(d.querySelectorAll(".edge-nav a")).forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var i = href.indexOf("#");
      if (i >= 0) links[href.slice(i + 1)] = a;
    });
    var els = SPY.map(function (id) { return d.getElementById(id); });
    // the all-work page carries one of these sections, so there is nothing to
    // spy on there — its nav state and sheet number are fixed in the markup
    if (els.filter(Boolean).length < 2) return;

    function apply() {
      // the landing section counts as one of the six, so loading at the top
      // lights Home rather than nothing
      var trigger = H * 0.38, at = 0;
      for (var i = 0; i < els.length; i++) {
        if (els[i] && els[i].getBoundingClientRect().top <= trigger) at = i;
      }
      for (var j = 0; j < SPY.length; j++) {
        var a = links[SPY[j]];
        if (a) a.classList.toggle("active", j === at);
      }
      if (sheetEl) sheetEl.textContent = at + 1;
      // the route section is itself a drawing, and the backdrop scene lands
      // across it; it steps aside while that section is the one being read
      if (cv) cv.classList.toggle("is-off", SPY[at] === "route");
    }
    addEventListener("scroll", apply, { passive: true });
    addEventListener("resize", apply);
    apply();
  }

  /* ===== selected work =====
     A grid of cards on the sheet's own paper, with the colour in the type,
     and one record that opens in the middle of the screen behind whichever
     card is clicked. The grid never reflows, so a reader keeps their place in it;
     the record can be walked with the arrow keys without ever being shut.
     Every string below comes out of work-data.js — this reads the content,
     it holds none. */
  var WK = { entries: [], rows: [], open: -1, back: null };

  function wkEsc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderWork() {
    var host = $("#work-list");
    if (!host) return;
    var data = window.WORK_ENTRIES || [];
    var groups = window.WORK_GROUPS || [];
    var L = window.WORK_LABELS || {};
    var html = "", order = [];

    groups.forEach(function (g) {
      var inGroup = data.filter(function (e) { return e.group === g.id; });
      if (!inGroup.length) return;
      html += '<p class="wk-glabel" data-testid="work-group-' + g.id + '">' +
        wkEsc(g.label) + '</p>';
      // two to a row, every card the same height, both groups drawn alike:
      // the labels do the separating, so nothing is colour-coded
      html += '<div class="wk-grid" data-testid="work-grid-' + g.id + '">';
      inGroup.forEach(function (e) {
        var i = order.length;
        order.push(e);
        var soon = e.status === "coming-soon";
        // the whole card is the control, so there is nothing on it to aim at
        html += '<button type="button" class="wk-card" data-i="' + i + '"' +
          (soon ? ' data-status="coming-soon"' : "") +
          ' data-testid="work-row-' + wkEsc(e.id) + '"' +
          ' aria-haspopup="dialog" aria-expanded="false">' +

          // the registration marks a drawing sheet is trimmed to
          '<span class="wk-ticks" aria-hidden="true">' +
            '<i class="tk tl"></i><i class="tk tr"></i>' +
            '<i class="tk bl"></i><i class="tk br"></i>' +
          '</span>' +

          // the sheet number, and the tag the machine is known by
          '<span class="wk-head">' +
            '<span class="wk-no">' + ("0" + (i + 1)).slice(-2) + '</span>' +
            '<span class="wk-tag' + (soon ? " is-soon" : "") + '">' +
              (soon ? wkEsc(L.comingSoon || "In progress") : wkEsc(e.tag)) +
            '</span>' +
          '</span>' +
          '<span class="wk-kind">' + wkEsc(e.industry) + ' \u00b7 ' +
            wkEsc(e.org) + ' \u00b7 ' + wkEsc(e.date) + '</span>' +

          '<span class="wk-body">' +
            '<span class="wk-ctitle">' + wkEsc(e.title) + '</span>' +
            '<span class="wk-sum">' + wkEsc(e.summary) + '</span>' +
          '</span>' +

          '<span class="wk-foot">' +
            '<span class="wk-period">' + wkEsc(e.period) + '</span>' +
            '<span class="wk-cta">' + wkEsc(L.cta || "Read the record") +
              '<span class="wk-arrow" aria-hidden="true">' +
                '<svg viewBox="0 0 16 16"><path d="M2 8h12M9.5 3.5 14 8l-4.5 4.5"/></svg>' +
              '</span>' +
            '</span>' +
          '</span>' +

        '</button>';
      });
      html += '</div>';
    });

    host.innerHTML = html;
    WK.entries = order;
    WK.rows = Array.prototype.slice.call(host.querySelectorAll(".wk-card"));
  }

  // the record, in the order the panel reads top to bottom
  function wkPanel(e) {
    var L = window.WORK_LABELS || {};
    function row(k, body) {
      return '<div class="wk-dsrow"><p class="wk-dsk">' + wkEsc(k) + '</p>' +
        '<div class="wk-dsv">' + body + '</div></div>';
    }

    var h = '<button type="button" class="wk-close" data-testid="work-close"' +
      ' aria-label="' + wkEsc(L.close || "Close") + '">×</button>';

    h += '<p class="wk-eyebrow" data-testid="work-eyebrow">' +
      wkEsc(e.industry) + ' · ' + wkEsc(e.tag) + '</p>';
    h += '<h3 class="wk-title" id="wk-title">' + wkEsc(e.title) + '</h3>';
    h += '<p class="wk-org">' + wkEsc(e.org) + ' · ' + wkEsc(e.period) + '</p>';
    if (e.link) {
      h += '<a class="wk-link" href="' + wkEsc(e.link.url) + '" target="_blank"' +
        ' rel="noopener" data-testid="work-link">' +
        '<span aria-hidden="true">↗</span>' + wkEsc(e.link.label) + '</a>';
    }

    h += '<div class="wk-rule" aria-hidden="true"></div>';

    // nothing is measured yet on work still in progress, so the figures are
    // replaced by the one line that is true of it
    var ms = e.metrics || [];
    if (e.status === "coming-soon" || !ms.length) {
      h += '<p class="wk-progress" data-testid="work-progress">' +
        wkEsc(L.comingSoon || "In progress") + '</p>';
    } else {
      h += '<div class="wk-metrics">';
      ms.forEach(function (m, n) {
        h += '<div class="wk-metric" data-testid="work-metric-' + (n + 1) + '">' +
          '<b>' + wkEsc(m.value) + '</b>' +
          '<span class="wk-mlabel">' + wkEsc(m.label) +
            '<button type="button" class="wk-i" data-m="' + n + '"' +
            ' data-testid="work-metric-toggle-' + (n + 1) + '"' +
            ' aria-expanded="false" aria-controls="wk-deriv-' + n + '"' +
            ' aria-label="' + wkEsc(L.derivation || "Derivation") + '">i</button>' +
          '</span></div>';
      });
      // the derivations sit under both figures, one row down the same grid
      ms.forEach(function (m, n) {
        h += '<p class="wk-deriv" id="wk-deriv-' + n + '" data-m="' + n + '"' +
          ' data-testid="work-derivation-' + (n + 1) + '">' +
          wkEsc(m.derivation) + '</p>';
      });
      h += '</div>';
    }

    h += '<div class="wk-rule" aria-hidden="true"></div>';

    h += '<div class="wk-ds" data-testid="work-datasheet">';
    h += row(L.problem || "Problem", '<p>' + wkEsc(e.problem) + '</p>');
    // a brief only earns a row when there was one
    if (e.brief) h += row(L.brief || "Brief", '<p>' + wkEsc(e.brief) + '</p>');
    h += row(L.did || "What I did", '<p>' + wkEsc(e.did) + '</p>');
    h += row(L.outcome || "Outcome",
      '<ul>' + (e.outcome || []).map(function (o) {
        return '<li>' + wkEsc(o) + '</li>';
      }).join("") + '</ul>');
    h += '</div>';

    h += '<div class="wk-skills">' + (e.skills || []).map(function (s) {
      return '<span class="wk-skill">' + wkEsc(s) + '</span>';
    }).join("") + '</div>';

    return h;
  }

  function wkOpen(i) {
    var e = WK.entries[i];
    var ov = $("#work-overlay"), panel = $("#work-panel"), host = $("#work-list");
    if (!e || !ov || !panel || !host) return;

    // where the focus came from, so Escape can put it back on the row
    if (WK.open < 0) WK.back = d.activeElement;

    panel.innerHTML = wkPanel(e);
    panel.scrollTop = 0;
    ov.hidden = false;
    host.classList.add("wk-open");

    // the card has to be laid out small before the zoom is taken off it, or
    // it is already at full size by the time anything paints. A forced
    // reflow does that on the spot; a frame callback would not run at all
    // while the tab is in the background, and the record would never show.
    void ov.offsetWidth;
    ov.classList.add("open");

    WK.open = i;
    WK.rows.forEach(function (r, n) {
      r.classList.toggle("is-open", n === i);
      r.setAttribute("aria-expanded", n === i ? "true" : "false");
    });
    panel.focus();
  }

  function wkClose() {
    if (WK.open < 0) return;
    var ov = $("#work-overlay"), host = $("#work-list");
    var was = WK.open;
    WK.open = -1;
    if (ov) ov.classList.remove("open");
    if (host) host.classList.remove("wk-open");
    WK.rows.forEach(function (r) {
      r.classList.remove("is-open");
      r.setAttribute("aria-expanded", "false");
    });
    // the record is still on its way out, so it keeps its place until it lands
    function hide() { if (WK.open < 0 && ov) ov.hidden = true; }
    if (reduced) hide(); else setTimeout(hide, 300);
    var back = WK.rows[was] || WK.back;
    if (back && back.focus) back.focus();
  }

  // the arrows walk the list in the order it is drawn, and stop at both ends
  function wkStep(by) {
    if (WK.open < 0) return;
    var n = WK.open + by;
    if (n < 0 || n >= WK.entries.length) return;
    wkOpen(n);
  }

  function bindWork() {
    var host = $("#work-list"), ov = $("#work-overlay"), panel = $("#work-panel");
    if (!host || !ov || !panel) return;

    host.addEventListener("click", function (ev) {
      var row = ev.target.closest(".wk-card");
      if (!row) return;
      wkOpen(parseInt(row.getAttribute("data-i"), 10));
    });

    // anywhere off the record shuts it
    var backdrop = ov.querySelector(".wk-backdrop");
    if (backdrop) backdrop.addEventListener("click", wkClose);

    panel.addEventListener("click", function (ev) {
      if (ev.target.closest(".wk-close")) { wkClose(); return; }
      var i = ev.target.closest(".wk-i");
      if (!i) return;
      // a figure's derivation is shown on being asked for, and only then
      var deriv = panel.querySelector('.wk-deriv[data-m="' + i.getAttribute("data-m") + '"]');
      if (!deriv) return;
      var on = deriv.classList.toggle("on");
      i.setAttribute("aria-expanded", on ? "true" : "false");
    });

    addEventListener("keydown", function (ev) {
      if (WK.open < 0) return;
      if (ev.key === "Escape") { ev.preventDefault(); wkClose(); return; }
      if (ev.key === "ArrowDown") { ev.preventDefault(); wkStep(1); return; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); wkStep(-1); }
    });
  }

  // ===== the resume page =====
  // One column, read top to bottom, in the order the resume puts things.
  function renderResume() {
    var host = $("#resume-body");
    if (!host) return;
    function sect(id, label, body) {
      return '<section class="cv-sec" data-testid="cv-' + id + '">' +
        '<h2 class="cv-h">' + label + '</h2>' + body + '</section>';
    }
    function list(a) {
      return '<ul class="ds-body ds-outcome cv-list">' +
        a.map(function (o) { return '<li>' + o + '</li>'; }).join("") + '</ul>';
    }
    // the numbers pulled out of the bullets, so a reader skimming the rail
    // still gets the size of the thing without reading a word of prose
    function figs(m) {
      if (!m || !m.length) return "";
      return '<div class="cv-figs">' + m.map(function (f) {
        return '<div class="cv-fig"><b>' + f.n + '</b><i>' + f.l + '</i></div>';
      }).join("") + '</div>';
    }

    // schools
    var schools = SCHOOLS.map(function (e, j) {
      return '<article class="cv-row" data-testid="cv-school-' + (j + 1) + '">' +
        '<div class="cv-when"><p>' + e.when + '</p><p class="cv-loc">' + e.loc + '</p></div>' +
        '<div class="cv-what">' +
          '<h3 class="cv-org">' + e.org + '</h3>' +
          '<p class="cv-title">' + e.deg + '</p>' +
          '<p class="cv-note">' + e.hon + '</p>' +
        '</div>' +
      '</article>';
    }).join("");

    // the whole time at a place: the oldest role's start to the newest one's end
    function span(roles) {
      var first = roles[0].when.split("\u2014"),
          last = roles[roles.length - 1].when.split("\u2014");
      return last[0].trim() + " \u2014 " + first[first.length - 1].trim();
    }

    // posts, grouped the way the resume groups them
    function postsIn(group) {
      var out = "", seen = 0;
      for (var i = 0; i < CV.length; i++) {
        var c = CV[i];
        if (c.grp !== group) continue;
        seen++;
        var r = c.row === null || c.row === undefined ? null : ROWS[c.row];
        out += '<article class="cv-row" data-testid="cv-post-' + group.slice(0, 4).toLowerCase() + '-' + seen + '">' +
          '<div class="cv-when">' +
            '<p>' + span(c.roles) + '</p>' +
            '<p class="cv-loc">' + c.loc + '</p>' +
          '</div>' +
          '<div class="cv-what">' +
            '<h3 class="cv-org">' + c.org +
              (c.sub ? ' <span class="cv-sub">' + c.sub + '</span>' : '') + '</h3>' +
            (c.scope ? '<p class="cv-scope">' + c.scope + '</p>' : '') +
            c.roles.map(function (ro) {
              return '<div class="cv-role">' +
                '<p class="cv-rt">' + ro.t + '<span>' + ro.when + '</span></p>' +
                list(ro.b) +
                figs(ro.m) +
              '</div>';
            }).join("") +
            (c.sel ? '<p class="cv-sel"><b>Selected work</b>' + c.sel + '</p>' : '') +
            (r && r.link ? '<a class="rp-link" href="' + r.link.u + '" target="_blank" rel="noopener"><span class="arr">&searr;</span> ' + r.link.t + '</a>' : '') +
          '</div>' +
        '</article>';
      }
      return out;
    }

    // what got published
    var papers = PAPERS.map(function (a, k) {
      return '<article class="cv-row" data-testid="cv-paper-' + (k + 1) + '">' +
        '<div class="cv-when"><p>' + a.y + '</p></div>' +
        '<div class="cv-what">' +
          '<h3 class="cv-org cv-org-s">' + a.t + '</h3>' +
          '<p class="cv-note">' + a.w + '</p>' +
          (a.u ? '<a class="rp-link" href="' + a.u + '" target="_blank" rel="noopener"><span class="arr">&searr;</span> Read it</a>' : '') +
        '</div>' +
      '</article>';
    }).join("");

    // and what happens off the clock
    var off = BELT_ITEMS.map(function (b) {
      var ls = (b.ls || []).map(function (l) {
        return '<a class="rp-link" href="' + l.u + '" target="_blank" rel="noopener"><span class="arr">&searr;</span> ' + l.t + '</a>';
      }).join("");
      return '<article class="cv-row cv-row-tight">' +
        '<div class="cv-when"><p>' + b.k + '</p></div>' +
        '<div class="cv-what">' +
          '<h3 class="cv-org cv-org-s">' + b.n + '</h3>' +
          '<p class="cv-note">' + b.l + '</p>' +
          (ls ? '<div class="cv-inline">' + ls + '</div>' : '') +
        '</div>' +
      '</article>';
    }).join("");

    host.innerHTML =
      sect("posts", "Professional experience", postsIn("Professional experience")) +
      sect("projects", "Engineering projects", postsIn("Engineering projects")) +
      sect("skills", "Skills",
        '<div class="tags cv-tags">' +
          SKILLS.map(function (t) { return '<span class="tag">' + t + '</span>'; }).join("") +
        '</div>') +
      sect("schools", "Education", schools) +
      sect("papers", "Published and filed", papers) +
      sect("off", "Off the clock", off) +
      sect("links", "Where else to find me",
        '<div class="cv-links">' +
          '<a href="mailto:mehtasvarav@gmail.com">mehtasvarav@gmail.com</a>' +
          '<a href="https://www.linkedin.com/in/svara-mehta" target="_blank" rel="noopener">LinkedIn <span class="arr">&nearr;</span></a>' +
          '<a href="https://github.com/svara-2311" target="_blank" rel="noopener">GitHub <span class="arr">&nearr;</span></a>' +
          '<a href="work.html">Work</a>' +
          '<a href="index.html">Portfolio</a>' +
        '</div>');
  }

  // derivation toggles, wherever a metric ends up
  function bindMetrics() {
    Array.prototype.slice.call(d.querySelectorAll(".mi")).forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var m = btn.closest(".metric"), deriv = m && m.querySelector(".deriv");
        if (deriv) deriv.classList.toggle("show");
      });
    });
  }

  // ===== cursor glow =====
  // Off the home page the floor tiles no longer light up, so the cursor
  // carries its own small glow instead.
  function initCursorGlow() {
    if (reduced || matchMedia("(hover: none)").matches) return;
    var dot = d.createElement("div");
    dot.className = "cursor-glow";
    dot.setAttribute("aria-hidden", "true");
    d.body.appendChild(dot);
    var x = 0, y = 0, shown = false, pending = false;
    function paint() {
      pending = false;
      dot.style.transform = "translate3d(" + x + "px," + y + "px,0)";
      if (!shown) { dot.classList.add("on"); shown = true; }
    }
    addEventListener("pointermove", function (e) {
      x = e.clientX; y = e.clientY;
      if (!pending) { pending = true; requestAnimationFrame(paint); }
    }, { passive: true });
    addEventListener("pointerdown", function () { dot.classList.add("tap"); });
    addEventListener("pointerup", function () { dot.classList.remove("tap"); });
  }

  /* ===== contact: the work order =====
     Submissions go to Web3Forms, which relays them to CONTACT_TO. The access
     key below is meant to live in client-side code — it is a public, per-form
     identifier, not a credential, and it only ever lets someone post to this
     one form. Get yours at web3forms.com: enter the address you want the mail
     to arrive at, confirm the link they send, and paste the key here.

     While the key is blank the form still works — it hands the finished
     message to the reader's own mail app instead, and says so. */
  var CONTACT_TO = "mehtasvarav@gmail.com";
  var CONTACT_KEY = "";
  var CONTACT_API = "https://api.web3forms.com/submit";

  function initContactForm() {
    var form = $("#wo-form");
    if (!form) return;

    var note = $("#wo-note"),
        send = form.querySelector(".wo-send"),
        nameEl = $("#wo-name"),
        mailEl = $("#wo-email"),
        reEl = $("#wo-re"),
        msgEl = $("#wo-msg"),
        botEl = $("#wo-botcheck"),
        posting = false;

    var RESTING = CONTACT_KEY
      ? "Goes straight to my inbox. I reply within two working days."
      : "Opens your mail app with this filled in.";

    function say(text, kind) {
      note.textContent = text;
      note.className = "wo-note" + (kind ? " " + kind : "");
    }

    function flag(el, bad) {
      var field = el.closest(".wo-f");
      if (field) field.classList.toggle("bad", bad);
    }

    // clear a field's warning as soon as the reader starts fixing it
    [nameEl, mailEl, msgEl].forEach(function (el) {
      el.addEventListener("input", function () { flag(el, false); });
    });

    function check() {
      var name = nameEl.value.trim(),
          mail = mailEl.value.trim(),
          msg = msgEl.value.trim(),
          mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail),
          first = null;

      flag(nameEl, !name);
      flag(mailEl, !mailOk);
      flag(msgEl, !msg);

      if (!name) first = "Who is this from?";
      else if (!mail) first = "I need an address to reply to.";
      else if (!mailOk) first = "That return address does not look right.";
      else if (!msg) first = "Add a line or two about what you need.";

      if (first) { say(first, "warn"); return null; }
      return { name: name, email: mail, subject: reEl.value, message: msg };
    }

    function openMail(d) {
      var subject = "[" + d.subject + "] " + d.name,
          body = d.message + "\n\n\u2014 " + d.name + " <" + d.email + ">";
      window.location.href = "mailto:" + CONTACT_TO +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);
    }

    function viaMail(d) {
      say("Opening your mail app\u2026", "good");
      openMail(d);
    }

    function payload(d) {
      return {
        access_key: CONTACT_KEY,
        // what the mail looks like when it lands
        subject: "[" + d.subject + "] " + d.name,
        from_name: "Portfolio work order",
        replyto: d.email,
        name: d.name,
        email: d.email,
        re: d.subject,
        message: d.message,
        botcheck: ""
      };
    }

    function viaPost(d) {
      posting = true;
      send.disabled = true;
      say("Sending\u2026");

      fetch(CONTACT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload(d))
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { ok: res.ok && body.success !== false, body: body };
        });
      }).then(function (r) {
        if (!r.ok) throw new Error(r.body.message || "rejected");
        form.reset();
        say("Sent. I will come back to you within two working days.", "good");
      }).catch(function () {
        // never lose what they wrote — hand it to their mail app instead
        say("That did not go through. Opening your mail app so it is not lost\u2026", "warn");
        setTimeout(function () { openMail(d); }, 900);
      }).then(function () {
        posting = false;
        send.disabled = false;
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (posting) return;
      // the honeypot is invisible and off-screen: only a bot ticks it
      if (botEl && botEl.checked) {
        form.reset();
        say("Sent. I will come back to you within two working days.", "good");
        return;
      }
      var d = check();
      if (!d) return;
      if (CONTACT_KEY) { viaPost(d); } else { viaMail(d); }
    });

    say(RESTING);
  }

  // ===== hero typewriter =====
  var TYPE_WORDS = [
    "a product manager", "a mechanical engineer", "a robotics enthusiast",
    "an AI tinkerer", "a dancer", "a writer", "a deep tech enthusiast"
  ];
  function initTypewriter() {
    var el = $("#type-text");
    if (!el) return;
    if (reduced) { el.textContent = TYPE_WORDS[0]; return; }
    var wi = 0, ci = 0, deleting = false;
    function tick() {
      var word = TYPE_WORDS[wi];
      if (deleting) {
        ci--;
        el.textContent = word.slice(0, ci);
        if (ci === 0) {
          deleting = false;
          wi = (wi + 1) % TYPE_WORDS.length;
          setTimeout(tick, 220);
          return;
        }
      } else {
        ci++;
        el.textContent = word.slice(0, ci);
        if (ci === word.length) {
          setTimeout(function () { deleting = true; tick(); }, 1500);
          return;
        }
      }
      setTimeout(tick, deleting ? 32 : 58);
    }
    tick();
  }

  // ===== legend =====
  var legend = $(".legend"), lt = $("#legend-toggle"), lp = $("#legend-panel");
  if (lt) {
    lt.addEventListener("click", function () {
      var open = legend.classList.toggle("open");
      lp.hidden = !open;
      lt.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // ===== resize / init =====
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    mobile = W < 641;
    cW = W; cH = H;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    VPX = W * 0.5; HZ = -H * 0.02; F = H * (mobile ? 0.6 : 1.1);
    pr = makeProj(VPX, HZ, F, PLANT_CAMH);
    measure();
    if (reduced) renderStatic();
  }

  /* ===== The Route, drawn as an isometric site plan =====
     One road, with a structure on it for every place in route-data.js.

     The projection is true isometric: sx = (x - y)cos30, sy = (x + y)/2 - z.
     The road is laid along the two ground axes in alternation — out along
     +x, down along -y, then +x again — so it zig-zags across the sheet.
     That buys two things at once: every building sits square to its own
     stretch of road (a box aligned to a grid axis projects to a proper
     solid, whereas one aligned to a screen-horizontal road would collapse
     to a flat elevation), and the plan spreads over the page instead of
     running off one corner the way a single straight road would.

     Each leg's structures stand on one verge, which puts every one of them
     at screen x = cos30 * (t + off) — monotonic, so the plan reads left to
     right and never doubles back. The campus takes the first leg, the jobs
     the other two. */

  var RT_K = 0.866;
  var RT_LEGS = [
    { x: 0,  y: 0,   dx: 1, dy: 0,  len: 84 },
    { x: 84, y: 0,   dx: 0, dy: -1, len: 66 },
    { x: 84, y: -66, dx: 1, dy: 0,  len: 106 }
  ];
  var RT_HALF = 4;
  var rtBB = null;
  var RT_NO = {};

  function rtN(n) { return (Math.round(n * 100) / 100).toString(); }

  // every point goes through here, so the bounding box comes out for free
  // and the viewBox never has to be guessed at
  function rtP(x, y, z) {
    var sx = (x - y) * RT_K, sy = (x + y) * 0.5 - (z || 0);
    if (rtBB) {
      if (sx < rtBB[0]) rtBB[0] = sx;
      if (sy < rtBB[1]) rtBB[1] = sy;
      if (sx > rtBB[2]) rtBB[2] = sx;
      if (sy > rtBB[3]) rtBB[3] = sy;
    }
    return rtN(sx) + " " + rtN(sy);
  }
  function rtPC(x, y, z) { return rtP(x, y, z).replace(" ", ","); }
  function rtD(pts, open) {
    var d = "", i;
    for (i = 0; i < pts.length; i++) d += (i ? "L" : "M") + rtP(pts[i][0], pts[i][1], pts[i][2] || 0);
    return open ? d : d + "Z";
  }

  // where the road is, and its frame, at distance t along the zig-zag
  function rtAt(t) {
    var i, L, u, t0 = 0;
    for (i = 0; i < RT_LEGS.length; i++) {
      L = RT_LEGS[i];
      if (t <= t0 + L.len || i === RT_LEGS.length - 1) {
        u = t - t0;
        return { x: L.x + L.dx * u, y: L.y + L.dy * u,
                 dx: L.dx, dy: L.dy, px: -L.dy, py: L.dx };
      }
      t0 += L.len;
    }
  }
  // a ground point given as distance along the road, verge and setback
  function rtGP(t, side, off) {
    var f = rtAt(t);
    return [f.x + f.px * side * off, f.y + f.py * side * off];
  }

  /* The viewer sits off +x +y, so of a box's six faces three are seen: the
     roof, the wall on the y = y1 plane (which falls away to the left) and
     the wall on x = x1 (to the right). Each is filled before it is stroked,
     so the solid reads as a silhouette rather than a tangle of lines. */
  function rtBox(x0, y0, x1, y1, zb, h, cls) {
    var zt = zb + h, c = cls ? " " + cls : "";
    return '<path class="rt-top' + c + '" d="' +
             rtD([[x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]]) + '"/>' +
           '<path class="rt-wl' + c + '" d="' +
             rtD([[x0, y1, zt], [x1, y1, zt], [x1, y1, zb], [x0, y1, zb]]) + '"/>' +
           '<path class="rt-wr' + c + '" d="' +
             rtD([[x1, y0, zt], [x1, y1, zt], [x1, y1, zb], [x1, y0, zb]]) + '"/>';
  }

  // an upright panel on two posts, standing in the plane of its leg
  function rtPanel(f, gx, gy, w, zb, h, cls) {
    var ax = gx - f.dx * w / 2, ay = gy - f.dy * w / 2,
        bx = gx + f.dx * w / 2, by = gy + f.dy * w / 2;
    return '<path class="rt-panel' + (cls ? " " + cls : "") + '" d="' +
             rtD([[ax, ay, zb + h], [bx, by, zb + h], [bx, by, zb], [ax, ay, zb]]) + '"/>' +
           '<path class="rt-post" d="' + rtD([[ax, ay, zb], [ax, ay, 0]], true) + '"/>' +
           '<path class="rt-post" d="' + rtD([[bx, by, zb], [bx, by, 0]], true) + '"/>';
  }

  /* Text has to be sheared into the plane it is written on. Upright, for a
     sign board: the glyph x axis follows the leg, the y axis stays vertical.
     Flat, for a road name or a precinct name painted on the ground: the x
     axis follows the leg and the y axis its perpendicular. Both matrices
     have determinant cos30, so neither is degenerate. */
  function rtUp(f, x, y, z) {
    return "matrix(" + rtN((f.dx - f.dy) * RT_K) + "," + rtN((f.dx + f.dy) * 0.5) +
           ",0,1," + rtPC(x, y, z) + ")";
  }
  function rtFlat(f, x, y, z) {
    return "matrix(" + rtN((f.dx - f.dy) * RT_K) + "," + rtN((f.dx + f.dy) * 0.5) + "," +
           rtN((f.px - f.py) * RT_K) + "," + rtN((f.px + f.py) * 0.5) + "," + rtPC(x, y, z || 0) + ")";
  }

  // a footprint. d and perp are opposite grid axes, so one term of each
  // half-extent is always zero and the result is axis-aligned in x, y
  function rtFoot(s) {
    var f = rtAt(s.t),
        cx = f.x + f.px * s.side * s.off,
        cy = f.y + f.py * s.side * s.off,
        hx = Math.abs(f.dx * s.w / 2) + Math.abs(f.px * s.d / 2),
        hy = Math.abs(f.dy * s.w / 2) + Math.abs(f.py * s.d / 2);
    return { f: f, cx: cx, cy: cy, hx: hx, hy: hy,
             x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy };
  }

  function rtTree(t, side, off) {
    var p = rtGP(t, side, off), x = p[0], y = p[1];
    rtP(x, y, 5);                         // register the canopy's reach
    return { d: x + y, s:
      '<path class="rt-trunk" d="' + rtD([[x, y, 0], [x, y, 2.3]], true) + '"/>' +
      '<ellipse class="rt-canopy" cx="' + rtN((x - y) * RT_K) +
        '" cy="' + rtN((x + y) * 0.5 - 3.4) + '" rx="1.7" ry="1.25"/>' };
  }

  /* Break a name over two lines at the space nearest its middle. A board
     is as wide as its longest line, so "Applied Materials" set on one line
     needs a board wider than the gap to the next site; split, the board is
     narrower and the type on it can be bigger. */
  function rtWrap(name) {
    var parts = (name || "").split(" "), best = 0, bd = 1e9, i, a, b;
    if (name.length <= 10 || parts.length < 2) return [name];
    for (i = 1; i < parts.length; i++) {
      a = parts.slice(0, i).join(" ").length;
      b = parts.slice(i).join(" ").length;
      if (Math.abs(a - b) < bd) { bd = Math.abs(a - b); best = i; }
    }
    return [parts.slice(0, best).join(" "), parts.slice(best).join(" ")];
  }

  // a bigger board at the entrance to half the site, naming the half
  function rtGate(t, side, off, label, when) {
    var f = rtAt(t), p = rtGP(t, side, off),
        bw = Math.max((label || "").length * 0.74 * 2.9, 22) + 5,
        bz = 4, bh = 8,
        o = rtUp(f, p[0] - f.dx * bw / 2, p[1] - f.dy * bw / 2, bz + bh);
    return { d: p[0] + p[1], s:
      rtPanel(f, p[0], p[1], bw, bz, bh, "rt-gate") +
      '<text class="rt-gate-n" transform="' + o + '" x="' + rtN(bw / 2) + '" y="3.6">' +
        wkEsc((label || "").toUpperCase()) + '</text>' +
      '<text class="rt-gate-w" transform="' + o + '" x="' + rtN(bw / 2) + '" y="6.6">' +
        wkEsc(when || "") + '</text>' };
  }

  /* one structure: the solid, whatever stands on its roof, and the sign
     board that names it. Every site is named in the drawing itself. */
  function rtStruct(s, i, L) {
    var g = rtFoot(s), f = g.f, live = s.live ? " is-live" : "", out = "", k,
        vacant = s.kind === "vacant";

    /* Roof furniture is placed in the structure's own frame: a runs along
       the leg, b across it, both -1 to 1, with b = 1 the side facing away
       from the road. The legs run on two different ground axes, so working
       in x and y here would put the same block in a different place
       depending on which leg a site happened to land on. */
    function at(a, b) {
      return [g.cx + f.dx * (s.w / 2) * a + f.px * s.side * (s.d / 2) * b,
              g.cy + f.dy * (s.w / 2) * a + f.py * s.side * (s.d / 2) * b];
    }
    function on(a0, b0, a1, b1, zb, h, cls) {
      var c0 = at(a0, b0), c1 = at(a1, b1);
      return rtBox(Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]),
                   Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1]), zb, h, cls);
    }

    if (!vacant) out += rtBox(g.x0, g.y0, g.x1, g.y1, 0, s.h, live);

    if (s.kind === "unit") {
      out += on(-0.4, -0.3, 0.05, 0.35, s.h, 1.5, "rt-aux");
    } else if (s.kind === "hall") {
      // a long front range with a taller tower behind it, so a hall does
      // not read as another shed
      out += on(-0.7, 0.15, 0.7, 0.9, s.h, 2.2, "rt-aux");
      out += on(-0.22, 0.3, 0.22, 0.75, s.h + 2.2, 3.4, "rt-aux");
    } else if (s.kind === "works") {
      for (k = 0; k < 3; k++) {
        out += on(-0.78 + k * 0.64, 0.08, -0.5 + k * 0.64, 0.92, s.h, 2.2, "rt-aux");
      }
      out += on(0.84, 0.5, 0.96, 0.72, s.h, 7, "rt-aux");          // the stack
    } else if (s.kind === "plot") {
      out += on(0.3, 0.1, 0.85, 0.8, 0, s.h * 1.5, "rt-aux");
    }

    /* The sign board. It is sized from its own text, because a board that
       does not fit its name is the one thing that always looks wrong, and
       the spacing between sites in route-data.js is set to clear it. */
    var nn = RT_NO[s.id] || "",
        head = vacant ? [(s.when || "").toUpperCase()] : rtWrap(s.name),
        meta = (nn ? nn + " · " : "") + (vacant ? s.name : s.when),
        wide = head.reduce(function (m, l) { return Math.max(m, l.length); }, 0),
        bw = Math.max(wide * 0.56 * 3, meta.length * 0.68 * 1.8, 14) + 5,
        bz = 3.4, bh = head.length > 1 ? 10.4 : 7.4,
        bp = rtGP(s.t, s.side, s.off - s.d / 2 - 4.8),
        o = rtUp(f, bp[0] - f.dx * bw / 2, bp[1] - f.dy * bw / 2, bz + bh),
        cls = (vacant ? " is-soon" : "") + live;
    out += rtPanel(f, bp[0], bp[1], bw, bz, bh, "rt-sign" + cls);
    head.forEach(function (line, n) {
      out += '<text class="rt-sign-n' + cls + '" transform="' + o + '" x="' + rtN(bw / 2) +
             '" y="' + rtN(3.4 + n * 3.2) + '">' + wkEsc(line) + '</text>';
    });
    out += '<text class="rt-sign-w" transform="' + o + '" x="' + rtN(bw / 2) +
             '" y="' + rtN(bh - 1.3) + '">' + wkEsc(meta) + '</text>';

    /* One group per site, named by its id. That is what lets a row in the
       list below reach into the drawing and lift the building it names. */
    return { d: g.cx + g.cy,
             s: '<g class="rt-site" data-site="' + wkEsc(s.id) + '">' + out + '</g>' };
  }

  function renderRoute() {
    var host = $("#route-map");
    if (!host) return;
    var R = window.ROUTE;
    if (!R) { host.innerHTML = ""; return; }
    var L = R.labels || {}, sites = R.sites || [], P = R.precinct, W = R.works, u;

    /* The Experience list is the roster in route-data.js, named and ordered
       by hand, and its position there is the number that both the row and
       the board in the drawing carry. A site the roster leaves out still
       stands on the plan, just unnumbered, the way Mumbai and the two
       schools are. The drawing itself runs oldest to newest left to right
       whatever the roster says; it is a route, and a route has a direction. */
    var byId = {}, jobs = [];
    sites.forEach(function (s) { byId[s.id] = s; });
    (R.roster || []).forEach(function (id) { if (byId[id]) jobs.push(byId[id]); });
    RT_NO = {};
    jobs.forEach(function (s, n) { RT_NO[s.id] = ("0" + (n + 1)).slice(-2); });

    rtBB = [1e9, 1e9, -1e9, -1e9];

    /* ground — verge bands either side of every leg, divided into lots, and
       reaching only as far as that side of that leg is actually built on */
    var ground = "", built = {}, t0 = 0;
    RT_LEGS.forEach(function (leg, n) {
      var t1 = t0 + leg.len;
      sites.concat(R.scenery || []).forEach(function (s) {
        if (s.t >= t0 && (s.t < t1 || n === RT_LEGS.length - 1)) {
          built[n + ":" + s.side] =
            Math.max(built[n + ":" + s.side] || 0, s.off + s.d / 2 + 5);
        }
      });
      if (P && P.t0 >= t0 && P.t0 < t1) {
        built[n + ":" + P.side] = Math.max(built[n + ":" + P.side] || 0, P.off1);
      }
      t0 = t1;
    });
    RT_LEGS.forEach(function (leg, n) {
      [-1, 1].forEach(function (side) {
        var far = built[n + ":" + side] || 13,
            px = -leg.dy, py = leg.dx,
            at = function (uu, ss) {
              return [leg.x + leg.dx * uu + px * side * ss,
                      leg.y + leg.dy * uu + py * side * ss];
            };
        ground += '<path class="rt-verge" d="' +
          rtD([at(0, 6.8), at(leg.len, 6.8), at(leg.len, far), at(0, far)]) + '"/>';
        for (u = 16; u < leg.len - 3; u += 16) {
          ground += '<path class="rt-lot" d="' + rtD([at(u, 6.8), at(u, far)], true) + '"/>';
        }
      });
    });

    // the parcels each structure stands in
    sites.forEach(function (s) {
      var g = rtFoot(s), pad = 3.2;
      ground += '<path class="rt-parcel' + (s.kind === "vacant" ? " is-vacant" : "") +
        '" data-site="' + wkEsc(s.id) + '" d="' +
        rtD([[g.x0 - pad, g.y0 - pad], [g.x1 + pad, g.y0 - pad],
             [g.x1 + pad, g.y1 + pad], [g.x0 - pad, g.y1 + pad]]) + '"/>';
    });

    /* the education precinct: its own boundary, an open quad between the two
       halls, and a drive off the road */
    var campus = [];
    if (P) {
      var q = P.quad, mt = (q.t0 + q.t1) / 2, mo = (q.off0 + q.off1) / 2,
          pf = rtAt(mt),
          box = function (a, b, c, d) {
            return rtD([rtGP(a, P.side, b), rtGP(c, P.side, b),
                        rtGP(c, P.side, d), rtGP(a, P.side, d)]);
          };
      ground += '<path class="rt-precinct" d="' + box(P.t0, P.off0, P.t1, P.off1) + '"/>';
      ground += '<path class="rt-quad" d="' + box(q.t0, q.off0, q.t1, q.off1) + '"/>';
      ground += '<path class="rt-drive" d="' +
        rtD([rtGP(mt, P.side, RT_HALF), rtGP(mt, P.side, q.off0)], true) + '"/>';
      ground += '<text class="rt-zone" transform="' +
        rtFlat(pf, rtGP(mt, P.side, mo)[0], rtGP(mt, P.side, mo)[1]) +
        '" x="0" y="0">' + wkEsc(P.label || "") + '</text>';
      if (P.gate) campus.push(rtGate(P.gate.t, P.gate.side || P.side, P.gate.off, P.label, P.when));

      (P.blocks || []).forEach(function (b) {
        var bs = { t: b.t, side: P.side, off: b.off, w: b.w, d: b.d, h: b.h },
            bg = rtFoot(bs);
        campus.push({ d: bg.cx + bg.cy,
                      s: rtBox(bg.x0, bg.y0, bg.x1, bg.y1, 0, b.h, "rt-minor") });
      });
      (P.trees || []).forEach(function (p) { campus.push(rtTree(p[0], P.side, p[1])); });
    }

    // and the other half of the site, announced the same way
    var gates = [];
    if (W) gates.push(rtGate(W.at, W.side, W.off, W.label, W.when));

    // the rest of the estate: unnamed, low, and drawn back so it reads as
    // somewhere rather than as nine things on a line
    var filler = (R.scenery || []).map(function (b) {
      var bg = rtFoot(b);
      return { d: bg.cx + bg.cy,
               s: rtBox(bg.x0, bg.y0, bg.x1, bg.y1, 0, b.h, "rt-minor") };
    });

    /* the road: one ground band per leg, run past each end by its own
       half-width so the bends close up square */
    var road = "", centre = "";
    RT_LEGS.forEach(function (leg, n) {
      var ex = leg.dx * RT_HALF, ey = leg.dy * RT_HALF,
          px = -leg.dy * RT_HALF, py = leg.dx * RT_HALF,
          ax = leg.x - ex, ay = leg.y - ey,
          bx = leg.x + leg.dx * leg.len + ex, by = leg.y + leg.dy * leg.len + ey;
      road += '<path class="rt-road" d="' +
        rtD([[ax - px, ay - py], [bx - px, by - py],
             [bx + px, by + py], [ax + px, ay + py]]) + '"/>';
      centre += (n ? "L" : "M") + rtP(leg.x, leg.y, 0);
      if (n === RT_LEGS.length - 1) {
        centre += "L" + rtP(leg.x + leg.dx * leg.len, leg.y + leg.dy * leg.len, 0);
      }
    });

    // the years, painted flat on the road between structures
    var years = "";
    (R.marks || []).forEach(function (m) {
      var f = rtAt(m.at);
      years += '<text class="rt-year" transform="' + rtFlat(f, f.x, f.y) + '" x="0" y="0">' +
        wkEsc(m.label) + '</text>';
    });

    /* Painter's algorithm: anything further from the viewer has a smaller
       x + y, so sorting on that and drawing in order puts the near
       structures over the far ones. */
    var solids = sites.map(function (s, n) { return rtStruct(s, n, L); })
                      .concat(campus, gates, filler);
    [[20, 1, 7], [74, -1, 7], [92, 1, 7], [108, -1, 7], [128, 1, 7],
     [150, -1, 7], [172, 1, 7], [198, 1, 7], [228, 1, 7], [248, -1, 7]
    ].forEach(function (t) { solids.push(rtTree(t[0], t[1], t[2])); });
    solids.sort(function (a, b) { return a.d - b.d; });

    var pad = 6,
        vb = [rtN(rtBB[0] - pad), rtN(rtBB[1] - pad),
              rtN(rtBB[2] - rtBB[0] + pad * 2), rtN(rtBB[3] - rtBB[1] + pad * 2)].join(" ");

    var svg =
      '<svg class="rt-svg" viewBox="' + vb + '" role="img" aria-label="' +
        wkEsc(L.plan || "Site plan") + '">' +
        '<g class="rt-g-ground">' + ground + '</g>' +
        '<g class="rt-g-road">' + road +
          '<path class="rt-mark" d="' + centre + '"/>' +
          '<path class="rt-run" d="' + centre + '"/>' +
          '<circle class="rt-dot" r="2" cx="0" cy="0"/>' +
        '</g>' +
        '<g class="rt-g-paint">' + years + '</g>' +
        '<g class="rt-g-solids">' +
          solids.map(function (o) { return o.s; }).join("") +
        '</g>' +
      '</svg>';

    /* The schedule. Every board in the drawing carries a name and a date;
       this carries what each one actually was, which no board has room for,
       and it is what the section falls back to at phone width. */
    /* The list under the plan carries the jobs and nothing else. Mumbai and
       the two schools are named on the drawing and the schools have their
       own block beside this one, so repeating them here is just the same
       words twice.

       It is laid out down one column and then down the next rather than
       across, so the numbers read in order. The column height goes out with
       the list, so the rule under the last row of each column lands right
       whatever the roster grows to. */
    var sched = "", srows = Math.ceil(jobs.length / 2);
    jobs.forEach(function (s, n) {
      var tail = (n + 1) % srows === 0 || n === jobs.length - 1;
      sched +=
        '<li class="rt-row' + (s.live ? " is-live" : "") +
            (tail ? " is-coltail" : "") + '"' +
            ' data-site="' + wkEsc(s.id) + '"' +
            ' data-testid="route-stop-' + wkEsc(s.id) + '">' +
          '<span class="rt-rn">' + RT_NO[s.id] + '</span>' +
          '<span class="rt-rb">' +
            '<span class="rt-rname">' + wkEsc(s.name) +
              (s.sub ? '<span class="rt-rsub">' + wkEsc(s.sub) + '</span>' : "") +
            '</span>' +
            (s.note ? '<span class="rt-rnote">' + wkEsc(s.note) + '</span>' : "") +
          '</span>' +
          '<span class="rt-rwhen">' + wkEsc(s.when) + '</span>' +
        '</li>';
    });

    var edu = "";
    (R.education || []).forEach(function (e) {
      edu +=
        '<li class="rt-erow"' +
            (e.site ? ' data-site="' + wkEsc(e.site) + '"' : "") + '>' +
          '<span class="rt-eb">' +
            '<span class="rt-eorg">' + wkEsc(e.org) + '</span>' +
            '<span class="rt-edeg">' + wkEsc(e.deg) + '</span>' +
            (e.note ? '<span class="rt-enote">' + wkEsc(e.note) + '</span>' : "") +
          '</span>' +
          '<span class="rt-ewhen">' + wkEsc(e.when) +
            (e.loc ? '<span class="rt-eloc">' + wkEsc(e.loc) + '</span>' : "") +
          '</span>' +
        '</li>';
    });

    host.innerHTML =
      '<figure class="rt-plan">' +
        '<div class="rt-sheet">' + svg + '</div>' +
        '<figcaption class="rt-cap">' +
          '<span>' + wkEsc(L.plan || "") + '</span>' +
          '<span>' + wkEsc(L.legend || "") + '</span>' +
        '</figcaption>' +
      '</figure>' +
      '<div class="rt-under">' +
        '<section class="rt-block">' +
          '<p class="rt-h">' + wkEsc(L.key || "Experience") + '</p>' +
          '<ol class="rt-sched" style="--rt-rows:' + srows +
            '" data-testid="route-schedule">' + sched + '</ol>' +
        '</section>' +
        '<section class="rt-block rt-edu">' +
          '<p class="rt-h">' + wkEsc(L.education || "Education") + '</p>' +
          '<ul class="rt-elist" data-testid="route-education">' + edu + '</ul>' +
        '</section>' +
      '</div>';

    rtBB = null;
  }

  // the accent line walks the road while the section is on screen
  function initRoute() {
    var host = $("#route-map");
    if (!host) return;
    var svg = host.querySelector(".rt-svg");
    if (!svg) return;

    /* Hovering a row in either list below lifts its building clear of the
       plan and darkens the parcel under it, so the row and the thing it
       names are visibly the same entry. A job row points at its works, a
       degree row at the hall it was earned in. The group and its parcel
       both answer to the site id, so one lookup reaches everything that
       has to move. */
    /* Scoped to the lists on purpose. The groups and parcels in the drawing
       carry the same attribute, and hanging this off them would make a
       building that lifts out from under the cursor drop and lift again. */
    Array.prototype.forEach.call(host.querySelectorAll(".rt-under [data-site]"),
      function (row) {
        var kin = svg.querySelectorAll('[data-site="' + row.getAttribute("data-site") + '"]');
        function set(on) {
          row.classList.toggle("is-lift", on);
          Array.prototype.forEach.call(kin, function (el) {
            el.classList.toggle("is-lift", on);
          });
        }
        row.addEventListener("mouseenter", function () { set(true); });
        row.addEventListener("mouseleave", function () { set(false); });
      });

    var run = svg.querySelector(".rt-run"), dot = svg.querySelector(".rt-dot");
    if (!run || !dot) return;

    if (reduced || !run.getTotalLength) {
      run.style.strokeDasharray = "none";
      dot.style.display = "none";
      return;
    }

    var len = run.getTotalLength(),
        CYCLE = 6200, HOLD = 1500,
        running = false, t0 = null, raf = 0;
    run.style.strokeDasharray = len;
    run.style.strokeDashoffset = len;

    function tick(ts) {
      if (!running) return;
      if (t0 === null) t0 = ts;
      var e = (ts - t0) % (CYCLE + HOLD),
          p = Math.min(1, e / CYCLE),
          at = run.getPointAtLength(p * len);
      run.style.strokeDashoffset = len * (1 - p);
      dot.setAttribute("cx", at.x);
      dot.setAttribute("cy", at.y);
      dot.style.opacity = p > 0.002 && p < 0.998 ? "1" : "0";
      raf = requestAnimationFrame(tick);
    }
    function start() { if (running) return; running = true; t0 = null; raf = requestAnimationFrame(tick); }
    function stop() { running = false; cancelAnimationFrame(raf); }

    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { start(); } else { stop(); }
      }, { threshold: 0 }).observe(svg);
    } else {
      start();
    }
  }


  // markup first, then measurements, then anything that reads geometry —
  // bindStack and initSpy both need the viewport size resize() establishes
  buildScene();
  renderStack();
  renderWork();
  renderBelt();
  renderResume();
  bindMetrics();
  initTypewriter();
  renderRoute();
  initContactForm();
  initRoute();
  initCursorGlow();
  resize();
  bindStack();
  bindWork();
  bindBelt();
  initSpy();

  addEventListener("resize", function () { resize(); });
  addEventListener("scroll", function () { if (reduced) renderStatic(); }, { passive: true });

  if (reduced) {
    renderStatic();
  } else {
    requestAnimationFrame(frame);
  }

})();

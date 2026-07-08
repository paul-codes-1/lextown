(function(){
'use strict';
/* LEXTOWN-01 — stylized downtown Lexington, KY block simulator.
   Real street grid, landmark massing, agent traffic + peds, day/night, detection HUD. */

// ---------- renderer / scene ----------
var glCanvas = document.getElementById('gl');
var IS_COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
var renderer = new THREE.WebGLRenderer({canvas: glCanvas, antialias: !IS_COARSE});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_COARSE ? 1.5 : 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = !IS_COARSE;   // phones skip the shadow pass
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(55, 1, 1, 5000);

var hemi = new THREE.HemisphereLight(0x8fb0d4, 0x4a4a40, 0.6);
scene.add(hemi);
var sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -380; sun.shadow.camera.right = 380;
sun.shadow.camera.top = 380; sun.shadow.camera.bottom = -380;
sun.shadow.camera.near = 50; sun.shadow.camera.far = 1600;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
scene.fog = new THREE.FogExp2(0x1a1030, 0.0011);

// ---------- street grid ----------
var SW = 16;                      // street width
var X0 = -520, X1 = 300, Z0 = -400, Z1 = 300;   // map extents
// dirs: EW +1 = eastbound(+x); NS +1 = southbound(+z)
var EW = [
  {name:'THIRD ST',  z:-300, dirs:[1,-1]},
  {name:'SECOND ST', z:-200, dirs:[-1]},
  {name:'SHORT ST',  z:-100, dirs:[1]},
  {name:'MAIN ST',   z:0,    dirs:[1]},
  {name:'VINE ST',   z:100,  dirs:[-1]},
  {name:'HIGH ST',   z:200,  dirs:[1,-1]}
];
var NS = [
  {name:'BROADWAY',  x:-200, dirs:[1,-1]},
  {name:'MILL ST',   x:-100, dirs:[-1]},
  {name:'UPPER ST',  x:0,    dirs:[-1]},
  {name:'LIMESTONE', x:100,  dirs:[1]},
  {name:'MLK BLVD',  x:200,  dirs:[1,-1]}
];

// ---------- canvas texture helpers ----------
function makeTex(w, h, draw){
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  var t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function asphaltBase(g, w, h){
  g.fillStyle = '#34373d'; g.fillRect(0, 0, w, h);
  for (var i = 0; i < w * h / 50; i++){
    g.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.045) + ')';
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  for (i = 0; i < w * h / 500; i++){
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
  }
}
// EW road: dashes run along u (horizontal)
var roadTexH = makeTex(256, 128, function(g, w, h){
  asphaltBase(g, w, h);
  g.fillStyle = 'rgba(230,230,220,0.5)';
  for (var x = 0; x < w; x += 34) g.fillRect(x, h/2 - 1.5, 18, 3);
  g.fillStyle = 'rgba(230,230,220,0.35)';
  g.fillRect(0, 5, w, 2.5); g.fillRect(0, h - 8, w, 2.5);
});
var roadTexV = makeTex(128, 256, function(g, w, h){
  asphaltBase(g, w, h);
  g.fillStyle = 'rgba(230,230,220,0.5)';
  for (var y = 0; y < h; y += 34) g.fillRect(w/2 - 1.5, y, 3, 18);
  g.fillStyle = 'rgba(230,230,220,0.35)';
  g.fillRect(5, 0, 2.5, h); g.fillRect(w - 8, 0, 2.5, h);
});
var xwalkTex = makeTex(256, 256, function(g, w, h){
  asphaltBase(g, w, h);
  g.fillStyle = 'rgba(235,235,225,0.75)';
  var i;
  for (i = 28; i < w - 28; i += 22){ g.fillRect(i, 6, 12, 26); g.fillRect(i, h - 32, 12, 26); }
  for (i = 28; i < h - 28; i += 22){ g.fillRect(6, i, 26, 12); g.fillRect(w - 32, i, 26, 12); }
});

// facade variants: {map, em} pairs — palette matched to Google 3D reference
// captures of downtown (buff + red brick w/ white trim, painted masonry,
// limestone civic, a few dark glass towers).
function facadeVariant(base, winCol, litCols, density, sill){
  var map = makeTex(128, 128, function(g){
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (var r0 = 0; r0 < 5; r0++) g.fillRect(0, r0 * 25.6, 128, 2);
    for (var r = 0; r < 5; r++) for (var c = 0; c < 4; c++){
      var x = c * 32 + 7, y = r * 25.6 + 6;
      g.fillStyle = winCol; g.fillRect(x, y, 18, 13);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, 18, 1.5);  // glass glint
      if (sill){ g.fillStyle = sill; g.fillRect(x - 1.5, y + 13, 21, 2.5); }
    }
  });
  var em = makeTex(128, 128, function(g){
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    for (var r = 0; r < 5; r++) for (var c = 0; c < 4; c++){
      if (Math.random() < density){
        g.fillStyle = litCols[(Math.random() * litCols.length) | 0];
        g.fillRect(c * 32 + 7, r * 25.6 + 6, 18, 13);
      }
    }
  });
  map.encoding = THREE.sRGBEncoding;
  return {map: map, em: em};
}
var WARM = ['#ffd9a4', '#ffe9c8', '#f7c87e', '#cfe6ff'];
var SILL = '#ddd6c8';
var VARIANTS = [
  facadeVariant('#9c5240', '#2a2e38', WARM, 0.42, SILL),  // 0 red brick, white sills
  facadeVariant('#b49a76', '#2b2f3a', WARM, 0.38, SILL),  // 1 buff brick
  facadeVariant('#d8d3c6', '#333844', WARM, 0.45, null),  // 2 white-painted masonry
  facadeVariant('#c2b193', '#2b2f3a', WARM, 0.45, SILL),  // 3 tan masonry
  facadeVariant('#9aa0a8', '#252b36', WARM, 0.5,  null),  // 4 gray office
  facadeVariant('#3a545c', '#16222a', WARM, 0.6,  null),  // 5 teal-dark glass
  facadeVariant('#c9c2b4', '#2a2f38', WARM, 0.3,  SILL),  // 6 limestone civic
  facadeVariant('#26476b', '#0d1826', ['#cfe6ff', '#ffe9c8', '#bfeaff'], 0.72, null), // 7 Big Blue glass
  facadeVariant('#5a4a3a', '#141118', WARM, 0.5,  null),  // 8 bronze glass
  facadeVariant('#1f4247', '#0e1c1f', WARM, 0.62, null)   // 9 City Center teal glass
];
// roofs: downtown reads as mostly white membrane + a few dark/green ones
var roofWhite = new THREE.MeshStandardMaterial({color: 0xd3d3cb, roughness: 1});
var roofDark = new THREE.MeshStandardMaterial({color: 0x3a3d42, roughness: 1});
var roofGreen = new THREE.MeshStandardMaterial({color: 0x3f7d72, roughness: 0.7, metalness: 0.15});
var roofMat = roofDark;
function pickRoof(h){
  if (h > 50) return Math.random() < 0.6 ? roofDark : roofWhite;
  var r = Math.random();
  return r < 0.68 ? roofWhite : r < 0.9 ? roofDark : roofGreen;
}
// storefront band textures (ground floor: awning strip + glass + mullions)
var AWNING_COLS = ['#7a3a34', '#3a5a44', '#2f4a66', '#6b5a2f', '#4a3a56'];
function storefrontVariant(awn){
  var map = makeTex(128, 64, function(g){
    g.fillStyle = '#d0cabc'; g.fillRect(0, 0, 128, 64);          // sign band
    g.fillStyle = awn; g.fillRect(0, 14, 128, 10);               // awning strip
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 22, 128, 2);
    g.fillStyle = '#1e242c'; g.fillRect(0, 26, 128, 38);         // glass
    g.fillStyle = '#4a4438';
    for (var x = 0; x < 128; x += 26) g.fillRect(x, 26, 3, 38);  // mullions
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 28, 128, 4);
  });
  var em = makeTex(128, 64, function(g){
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
    for (var x = 0; x < 128; x += 26){
      if (Math.random() < 0.75){
        g.fillStyle = ['#ffd9a4', '#ffe9c8', '#ffc87e'][(Math.random() * 3) | 0];
        g.fillRect(x + 3, 26, 23, 38);
      }
    }
  });
  map.encoding = THREE.sRGBEncoding;
  return {map: map, em: em};
}
var STOREFRONTS = AWNING_COLS.map(storefrontVariant);

// materials whose emissiveIntensity tracks night factor: {m, k}
var nightMats = [];
function regNight(m, k){ nightMats.push({m: m, k: k}); return m; }

var labels = [];   // {name, x, y, z}
var colliders = [];   // {x0,x1,z0,z1} or {ell,cx,cz,rx,rz}
var slabRects = [];   // walkable raised block slabs

var GLASSY = {5: 1, 7: 1, 8: 1, 9: 1};
function towerMats(vi, w, h, roof){
  var v = VARIANTS[vi];
  var map = v.map.clone(); map.needsUpdate = true;
  var em = v.em.clone(); em.needsUpdate = true;
  var rx = Math.max(1, Math.round(w / 13)), ry = Math.max(1, Math.round(h / 15));
  map.repeat.set(rx, ry); em.repeat.set(rx, ry);
  var side = new THREE.MeshStandardMaterial({
    map: map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0,
    roughness: GLASSY[vi] ? 0.5 : 0.9, metalness: GLASSY[vi] ? 0.3 : 0
  });
  regNight(side, 0.75 + Math.random() * 0.55);
  var rm = roof || pickRoof(h);
  return [side, side, rm, rm, side, side];
}
var MASONRY = {0: 1, 1: 1, 2: 1, 3: 1, 6: 1};
var corniceMat = new THREE.MeshStandardMaterial({color: 0xddd6c8, roughness: 0.9});
var acPts = [];   // rooftop AC units, instanced later
function addTower(x, z, w, d, h, vi, name){
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), towerMats(vi, Math.max(w, d), h));
  m.position.set(x, h / 2 + 0.35, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  colliders.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: h + 0.35});
  // white cornice / parapet cap on masonry buildings (reference: everywhere downtown)
  if (MASONRY[vi] && h < 45){
    var cor = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.6, d + 0.8), corniceMat);
    cor.position.set(x, h + 0.55, z); cor.castShadow = true; scene.add(cor);
  }
  // rooftop AC clutter on everything mid-rise and lower
  if (h < 70 && w > 10){
    var nAc = 1 + (Math.random() * 3) | 0;
    for (var a = 0; a < nAc; a++)
      acPts.push([x + (Math.random() - 0.5) * w * 0.55,
                  h + 0.9, z + (Math.random() - 0.5) * d * 0.55]);
  }
  if (name) labels.push({name: name, x: x, y: h + 7, z: z});
  return m;
}
// ground-floor storefront band (drawn as a thin wrap box at street level)
function addStorefront(x, z, w, d){
  var v = STOREFRONTS[(Math.random() * STOREFRONTS.length) | 0];
  var map = v.map.clone(); map.needsUpdate = true;
  var em = v.em.clone(); em.needsUpdate = true;
  map.repeat.set(Math.max(1, Math.round(w / 9)), 1);
  em.repeat.set(map.repeat.x, 1);
  var mat = new THREE.MeshStandardMaterial({map: map, emissiveMap: em,
    emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.7});
  regNight(mat, 1.4 + Math.random() * 0.5);
  var m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 4.4, d + 0.5),
    [mat, mat, roofDark, roofDark, mat, mat]);
  m.position.set(x, 2.2 + 0.35, z);
  scene.add(m);
}

// ---------- ground / streets ----------
var ground = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800),
  new THREE.MeshStandardMaterial({color: 0x2c3226, roughness: 1}));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

EW.forEach(function(s){
  var t = roadTexH.clone(); t.needsUpdate = true; t.repeat.set((X1 - X0) / 60, 1);
  var m = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, SW),
    new THREE.MeshStandardMaterial({map: t, roughness: 0.95}));
  m.rotation.x = -Math.PI / 2; m.position.set((X0 + X1) / 2, 0.05, s.z);
  m.receiveShadow = true; scene.add(m);
});
NS.forEach(function(s){
  var t = roadTexV.clone(); t.needsUpdate = true; t.repeat.set(1, (Z1 - Z0) / 60);
  var m = new THREE.Mesh(new THREE.PlaneGeometry(SW, Z1 - Z0),
    new THREE.MeshStandardMaterial({map: t, roughness: 0.95}));
  m.rotation.x = -Math.PI / 2; m.position.set(s.x, 0.1, (Z0 + Z1) / 2);
  m.receiveShadow = true; scene.add(m);
});
// intersection patches with crosswalks
(function(){
  var g = new THREE.PlaneGeometry(SW + 7, SW + 7);
  var mat = new THREE.MeshStandardMaterial({map: xwalkTex, roughness: 0.95});
  var im = new THREE.InstancedMesh(g, mat, EW.length * NS.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  var i = 0, one = new THREE.Vector3(1, 1, 1);
  EW.forEach(function(e){ NS.forEach(function(n){
    M.compose(new THREE.Vector3(n.x, 0.15, e.z), q, one);
    im.setMatrixAt(i++, M);
  }); });
  im.receiveShadow = true; scene.add(im);
})();

// ---------- block slabs + procedural buildings ----------
var slabMat = new THREE.MeshStandardMaterial({color: 0xa7a49c, roughness: 1});
var parkMat = new THREE.MeshStandardMaterial({color: 0x53703f, roughness: 1});
// red brick pavers — courthouse square + circuit court plaza in the reference
var paverTex = makeTex(128, 128, function(g){
  g.fillStyle = '#9c5a48'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (var y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 1.5);
  for (var x = 0; x < 128; x += 16) g.fillRect(x, 0, 1.5, 128);
  for (var i = 0; i < 260; i++){
    g.fillStyle = 'rgba(255,235,220,' + (Math.random() * 0.06) + ')';
    g.fillRect(Math.random() * 128, Math.random() * 128, 4, 3);
  }
});
paverTex.encoding = THREE.sRGBEncoding;
var paverMat = new THREE.MeshStandardMaterial({map: paverTex, roughness: 1});
paverMat.map.repeat.set(8, 8);
// surface parking lot (striped) — half of real downtown is parking lots
var lotTex = makeTex(256, 256, function(g){
  asphaltBase(g, 256, 256);
  g.fillStyle = 'rgba(235,235,225,0.55)';
  for (var y = 40; y < 256; y += 88)
    for (var x = 10; x < 256; x += 28) g.fillRect(x, y, 2.5, 40);
});
var treePts = [];
function slab(x0, z0, x1, z1, mat){
  var m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.7, z1 - z0), mat || slabMat);
  m.position.set((x0 + x1) / 2, 0.35, (z0 + z1) / 2);
  m.receiveShadow = true; scene.add(m);
  slabRects.push({x0: x0, x1: x1, z0: z0, z1: z1});
  return m;
}
var neonCols = [0xff2d95, 0x25f4ee, 0xffd23f, 0x7cff4f, 0xff7a3d];
function addSign(x, y, z, rotY){
  var w = 2.5 + Math.random() * 3;
  var mat = new THREE.MeshStandardMaterial({color: 0x0a0a0a,
    emissive: neonCols[(Math.random() * neonCols.length) | 0], emissiveIntensity: 0});
  regNight(mat, 2.2 + Math.random());
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.18), mat);
  m.position.set(x, y, z); m.rotation.y = rotY;
  scene.add(m);
}
var parkedPts = [];   // static parked cars, built after CAR_COLS exists
function addParkingLot(px0, pz0, px1, pz1){
  var w = px1 - px0, d = pz1 - pz0;
  var t = lotTex.clone(); t.needsUpdate = true;
  t.repeat.set(Math.max(1, w / 34), Math.max(1, d / 34));
  var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({map: t, roughness: 1}));
  m.rotation.x = -Math.PI / 2;
  m.position.set((px0 + px1) / 2, 0.74, (pz0 + pz1) / 2);
  m.receiveShadow = true; scene.add(m);
  var n = 2 + (Math.random() * Math.min(6, w * d / 220)) | 0;
  for (var k = 0; k < n; k++)
    parkedPts.push([px0 + 4 + Math.random() * (w - 8), pz0 + 4 + Math.random() * (d - 8),
                    Math.random() < 0.5 ? 0 : Math.PI / 2]);
  treePts.push([px0 + 2, pz0 + 2]);
}
function procBlock(x0, z0, x1, z1){
  slab(x0, z0, x1, z1);
  var cols = Math.random() < 0.5 ? 2 : 1, rows = Math.random() < 0.6 ? 2 : 1;
  if (cols === 1 && rows === 1 && Math.random() < 0.7) cols = 2;
  var cw = (x1 - x0) / cols, rh = (z1 - z0) / rows;
  for (var ci = 0; ci < cols; ci++) for (var ri = 0; ri < rows; ri++){
    var px0 = x0 + ci * cw + 3, pz0 = z0 + ri * rh + 3;
    var px1 = x0 + (ci + 1) * cw - 3, pz1 = z0 + (ri + 1) * rh - 3;
    var r = Math.random();
    if (r < 0.06){ // pocket park
      for (var k = 0; k < 4; k++)
        treePts.push([px0 + Math.random() * (px1 - px0), pz0 + Math.random() * (pz1 - pz0)]);
      continue;
    }
    if (r < 0.24){ // surface parking lot — a defining downtown Lexington feature
      addParkingLot(px0, pz0, px1, pz1);
      continue;
    }
    var w = (px1 - px0) * (0.75 + Math.random() * 0.25);
    var d = (pz1 - pz0) * (0.75 + Math.random() * 0.25);
    var h = r < 0.62 ? 8 + Math.random() * 12 : r < 0.9 ? 18 + Math.random() * 18 : 40 + Math.random() * 26;
    var vi = h > 38 ? (Math.random() < 0.5 ? 5 : 4) : (Math.random() * 4) | 0;
    var bx = (px0 + px1) / 2, bz = (pz0 + pz1) / 2;
    addTower(bx, bz, w, d, h, vi);
    var retail = Math.abs(bz) < 160 && MASONRY[vi] && h < 28;
    if (retail) addStorefront(bx, bz, w, d);
    if (Math.random() < 0.5 && retail){
      var south = bz > 0;
      addSign(bx - w / 4 + Math.random() * (w / 2), 5.2,
        south ? bz - d / 2 - 0.55 : bz + d / 2 + 0.55, 0);
    }
  }
}

// blocks between streets; skip landmark blocks
var SKIP = {'0-2':1, '0-3':1, '0-4':1, '1-0':1, '1-2':1, '1-3':1, '1-4':1, '2-2':1, '3-2':1, '3-3':1};
for (var i = 0; i < NS.length - 1; i++){
  for (var j = 0; j < EW.length - 1; j++){
    var bx0 = NS[i].x + SW / 2 + 3, bx1 = NS[i + 1].x - SW / 2 - 3;
    var bz0 = EW[j].z + SW / 2 + 3, bz1 = EW[j + 1].z - SW / 2 - 3;
    if (SKIP[i + '-' + j]) continue;
    procBlock(bx0, bz0, bx1, bz1);
  }
}

// ---------- landmarks ----------
// Block (0,2): Victorian Square — red brick + white trim, Main & Broadway
slab(-192, -92, -108, -8);
addTower(-170, -32, 38, 40, 13, 0, 'VICTORIAN SQUARE');
addTower(-131, -45, 32, 22, 13, 0);
addStorefront(-170, -32, 38, 40);
addTower(-150, -74, 42, 22, 10, 2);

// Block (1,0): First Presbyterian-style church (green copper roof + steeple)
slab(-92, -292, -8, -208);
(function(){
  var nave = addTower(-46, -252, 20, 34, 9, 0);
  var gable = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 33, 3, 1), roofGreen);
  gable.rotation.x = Math.PI / 2; gable.rotation.z = Math.PI;
  gable.scale.set(1, 1, 0.55);
  gable.position.set(-46, 9.35, -252); gable.castShadow = true; scene.add(gable);
  var tower = addTower(-46, -273, 6.5, 6.5, 16, 0);
  var spire = new THREE.Mesh(new THREE.ConeGeometry(4.4, 12, 4), roofDark);
  spire.rotation.y = Math.PI / 4;
  spire.position.set(-46, 22.5, -273); spire.castShadow = true; scene.add(spire);
  labels.push({name: 'FIRST PRESBYTERIAN', x: -46, y: 32, z: -262});
})();
addTower(-72, -230, 22, 28, 14, 1);
addTower(-20, -235, 20, 24, 11, 2);
for (var ch = 0; ch < 5; ch++) treePts.push([-88 + Math.random() * 76, -290 + Math.random() * 20]);

// Block (0,3): Triangle Park (west) + Big Blue (east)
slab(-192, 8, -150, 92, parkMat);
(function(){ // fountain
  var m = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1.6, 24),
    new THREE.MeshStandardMaterial({color: 0x8b939c, roughness: 0.7}));
  m.position.set(-171, 1.1, 40); m.castShadow = true; scene.add(m);
  var w = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.4, 24),
    new THREE.MeshStandardMaterial({color: 0x2e6f86, roughness: 0.2, metalness: 0.4}));
  w.position.set(-171, 1.9, 40); scene.add(w);
  labels.push({name: 'TRIANGLE PARK', x: -171, y: 14, z: 40});
})();
for (var tp = 0; tp < 12; tp++) treePts.push([-188 + Math.random() * 36, 12 + Math.random() * 76]);
slab(-146, 8, -108, 92);
addTower(-127, 32, 34, 26, 128, 7, 'LEXINGTON FINANCIAL CENTER · BIG BLUE');
// Central Bank Tower (300 W Vine, the ex-Kincaid Towers) sits just south,
// fronting Vine — tan stepped slab with a light cap, per the 3D reference
addTower(-126, 72, 30, 22, 88, 3, 'CENTRAL BANK TOWER');
(function(){
  var cap = new THREE.Mesh(new THREE.BoxGeometry(31, 2.2, 23),
    new THREE.MeshStandardMaterial({color: 0xd8d3c6, roughness: 0.8}));
  cap.position.set(-126, 89.6, 72); cap.castShadow = true; scene.add(cap);
})();
(function(){ // Big Blue crown: slanted glass top + lit band + spire + beacon
  var band = new THREE.Mesh(new THREE.BoxGeometry(34.6, 1.4, 26.6),
    regNight(new THREE.MeshStandardMaterial({color: 0x1a2634,
      emissive: 0xcfe8ff, emissiveIntensity: 0}), 2.2));
  band.position.set(-127, 124.5, 32); scene.add(band);
  var crown = new THREE.Mesh(new THREE.BoxGeometry(28, 7, 20),
    new THREE.MeshStandardMaterial({color: 0x1c2a3d, roughness: 0.4, metalness: 0.4}));
  crown.rotation.z = 0.24;
  crown.position.set(-127, 130.5, 32); crown.castShadow = true; scene.add(crown);
  var sp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 20, 6),
    new THREE.MeshStandardMaterial({color: 0x99a4b0}));
  sp.position.set(-127, 143, 32); scene.add(sp);
  var bk = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8),
    regNight(new THREE.MeshStandardMaterial({color: 0x220000, emissive: 0xff2222, emissiveIntensity: 0}), 3));
  bk.position.set(-127, 153, 32); scene.add(bk);
})();

// Block (0,4): gray ribbed offices + gold-glass cube (per reference; no
// "Kincaid" — that name left Lexington when 300 W Vine was rebranded)
slab(-192, 108, -108, 192);
addTower(-162, 138, 38, 30, 48, 4);
addTower(-124, 168, 26, 24, 28, 8);
addParkingLot(-188, 160, -146, 188);

// Block (1,3): City Center — podium + teal glass pair + white hotel slab
slab(-92, 8, -8, 92);
addTower(-50, 42, 78, 60, 12, 9);
addTower(-70, 40, 28, 26, 52, 9, 'CITY CENTER');
addTower(-32, 36, 24, 22, 44, 9);
addTower(-50, 76, 30, 14, 36, 2);

// Block (1,4): Vine Center-style gray offices (unlabeled filler)
slab(-92, 108, -8, 192);
addTower(-50, 142, 34, 30, 52, 4);
addTower(-70, 174, 26, 14, 16, 2);

// Block (1,2): 21c + low-rises
slab(-92, -92, -8, -8);
addTower(-20, -26, 18, 22, 58, 2, '21C MUSEUM HOTEL');
addTower(-58, -30, 34, 24, 18, 0);
addTower(-55, -70, 40, 20, 24, 1);

// Block (2,2): Old Courthouse square (Cheapside) — red paver plaza
slab(8, -92, 92, -8, paverMat);
(function(){
  var stone = towerMats(6, 36, 16);
  var base = new THREE.Mesh(new THREE.BoxGeometry(36, 15, 26), stone);
  base.position.set(50, 7.85, -45); base.castShadow = true; base.receiveShadow = true; scene.add(base);
  var civ = new THREE.MeshStandardMaterial({color: 0x9a938a, roughness: 0.85});
  var drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 6, 20), civ);
  drum.position.set(50, 18.3, -45); drum.castShadow = true; scene.add(drum);
  var dome = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({color: 0x3a3d42, roughness: 0.55, metalness: 0.25}));
  dome.position.set(50, 21.3, -45); dome.castShadow = true; scene.add(dome);
  var cup = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 4, 10), civ);
  cup.position.set(50, 29.5, -45); scene.add(cup);
  labels.push({name: 'OLD FAYETTE CO. COURTHOUSE', x: 50, y: 39, z: -45});
  // Fifth Third Pavilion canopy
  var can = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 12),
    new THREE.MeshStandardMaterial({color: 0x3d6e57, roughness: 0.7}));
  can.position.set(28, 6.5, -76); can.castShadow = true; scene.add(can);
  for (var p = 0; p < 4; p++){
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6.5, 6), civ);
    pole.position.set(28 + (p % 2 ? 9 : -9), 3.2, -76 + (p > 1 ? 4.5 : -4.5));
    scene.add(pole);
  }
})();
for (var cq = 0; cq < 7; cq++) treePts.push([14 + Math.random() * 70, -30 + Math.random() * 18]);

// Block (3,2): Circuit Court twin towers — red paver plaza
slab(108, -92, 192, -8, paverMat);
addTower(130, -50, 26, 30, 40, 6, 'FAYETTE CIRCUIT COURT');
addTower(170, -50, 26, 30, 40, 6);
(function(){
  var br = new THREE.Mesh(new THREE.BoxGeometry(16, 5, 10),
    new THREE.MeshStandardMaterial({color: 0x8a8478, roughness: 0.8}));
  br.position.set(150, 14, -50); br.castShadow = true; scene.add(br);
})();

// Block (3,3): Phoenix Park + Central Library + City Hall (Government
// Center — the 1920s Lafayette Hotel brick tower at 200 E Main)
slab(108, 8, 138, 92, parkMat);
for (var pp = 0; pp < 8; pp++) treePts.push([111 + Math.random() * 24, 12 + Math.random() * 76]);
labels.push({name: 'PHOENIX PARK', x: 122, y: 12, z: 50});
slab(142, 8, 192, 92);
addTower(151, 66, 16, 22, 26, 4, 'CENTRAL LIBRARY');
(function(){
  var hall = addTower(176, 34, 26, 40, 42, 0, 'CITY HALL · LFUCG GOV CENTER');
  // lighter arched-window top floor + deep cornice, hotel-style
  var topBand = new THREE.Mesh(new THREE.BoxGeometry(26.6, 4.5, 40.6),
    regNight(new THREE.MeshStandardMaterial({color: 0xc9c2b4,
      emissiveMap: VARIANTS[6].em, emissive: 0xffffff, emissiveIntensity: 0,
      roughness: 0.85}), 1.2));
  topBand.position.set(176, 39.8, 34); topBand.castShadow = true; scene.add(topBand);
  var cor = new THREE.Mesh(new THREE.BoxGeometry(28, 1.1, 42), corniceMat);
  cor.position.set(176, 42.9, 34); cor.castShadow = true; scene.add(cor);
  var flag = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 9, 6),
    new THREE.MeshStandardMaterial({color: 0xb8bcc4}));
  flag.position.set(176, 47.5, 34); scene.add(flag);
  var banner = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2, 0.12),
    new THREE.MeshStandardMaterial({color: 0x27418f, roughness: 0.8}));
  banner.position.set(177.9, 50, 34); scene.add(banner);
})();

// Rupp Arena / Central Bank Center (west of Broadway)
(function(){
  slab(-500, 12, -216, 190);
  var oval = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 22, 48),
    new THREE.MeshStandardMaterial({color: 0xe8e8e2, roughness: 0.6}));
  oval.scale.set(85, 1, 68); oval.position.set(-370, 11.7, 100);
  oval.castShadow = true; oval.receiveShadow = true; scene.add(oval);
  var podium = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 7, 48),
    new THREE.MeshStandardMaterial({color: 0x8a8478, roughness: 0.9}));
  podium.scale.set(92, 1, 75); podium.position.set(-370, 4.2, 100); scene.add(podium);
  labels.push({name: 'RUPP ARENA', x: -370, y: 34, z: 100});
  var conv = addTower(-248, 100, 42, 150, 14, 5, 'CENTRAL BANK CENTER');
})();

// colliders for custom landmark geometry
colliders.push({x0: 32, x1: 68, z0: -58, z1: -32, h: 15.7});        // old courthouse
colliders.push({x0: -176.5, x1: -165.5, z0: 34.5, z1: 45.5, h: 2.3}); // fountain
colliders.push({ell: 1, cx: -370, cz: 100, rx: 94, rz: 77, h: 23}); // Rupp oval

// street tree rows along Main + Vine (reference: continuous canopy downtown)
[0, 100].forEach(function(sz){
  for (var tx = -190; tx < 290; tx += 38){
    var nearX = NS.some(function(n){ return Math.abs(tx - n.x) < 15; });
    if (nearX) continue;
    if (Math.random() < 0.75) treePts.push([tx + Math.random() * 6, sz - 13.5]);
    if (Math.random() < 0.75) treePts.push([tx + Math.random() * 6, sz + 13.5]);
  }
});

// distant skyline filler ring
(function(){
  for (var k = 0; k < 55; k++){
    var a = Math.random() * Math.PI * 2;
    var rr = 620 + Math.random() * 360;
    var x = -110 + Math.cos(a) * rr, z = -50 + Math.sin(a) * rr * 0.8;
    if (x > X0 - 40 && x < X1 + 40 && z > Z0 - 40 && z < Z1 + 40) continue;
    var h = 8 + Math.random() * 42;
    var m = new THREE.Mesh(new THREE.BoxGeometry(18 + Math.random() * 34, h, 16 + Math.random() * 30),
      towerMats((Math.random() * 5) | 0, 30, h));
    m.position.set(x, h / 2, z); scene.add(m);
  }
})();

// rooftop AC units (instanced)
(function(){
  if (!acPts.length) return;
  var im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 1.1, 1.3),
    new THREE.MeshStandardMaterial({color: 0xc4c4bc, roughness: 0.9}), acPts.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  var e = new THREE.Euler();
  for (var k = 0; k < acPts.length; k++){
    q.setFromEuler(e.set(0, Math.random() * Math.PI, 0));
    M.compose(new THREE.Vector3(acPts[k][0], acPts[k][1], acPts[k][2]), q, one);
    im.setMatrixAt(k, M);
  }
  im.castShadow = true;
  scene.add(im);
})();

// trees (instanced)
(function(){
  var n = treePts.length;
  var trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
  var crownG = new THREE.IcosahedronGeometry(2.4, 1);
  var trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({color: 0x4a3626, roughness: 1}), n);
  var crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({color: 0x27452c, roughness: 1}), n);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (var k = 0; k < n; k++){
    var sc = 0.8 + Math.random() * 0.7;
    M.compose(new THREE.Vector3(treePts[k][0], 1.2 * sc + 0.6, treePts[k][1]), q, s.set(sc, sc, sc));
    trunk.setMatrixAt(k, M);
    M.compose(new THREE.Vector3(treePts[k][0], 3.4 * sc + 0.6, treePts[k][1]), q, s.set(sc, sc, sc));
    crown.setMatrixAt(k, M);
  }
  trunk.castShadow = crown.castShadow = true;
  scene.add(trunk); scene.add(crown);
})();

// ---------- street lights (instanced) ----------
var lampPts = [];
EW.forEach(function(e){ NS.forEach(function(n){
  lampPts.push([n.x + 13, e.z + 13]); lampPts.push([n.x - 13, e.z - 13]);
}); });
[0, 100].forEach(function(z){ // midblock on Main & Vine
  for (var x = X0 + 60; x < X1 - 30; x += 66) lampPts.push([x, z + 11.5]);
});
var lampGlowMat, lampHeadMat;
(function(){
  var n = lampPts.length;
  var pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 7, 6),
    new THREE.MeshStandardMaterial({color: 0x2c2f35, roughness: 0.8}), n);
  lampHeadMat = new THREE.MeshStandardMaterial({color: 0x1c1a12, emissive: 0xffd9a0, emissiveIntensity: 0});
  var head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 8), lampHeadMat, n);
  lampGlowMat = new THREE.MeshBasicMaterial({color: 0xdd9a4e, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false});
  var glow = new THREE.InstancedMesh(new THREE.CircleGeometry(4.2, 16), lampGlowMat, n);
  var M = new THREE.Matrix4(), qI = new THREE.Quaternion(),
      qF = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
      one = new THREE.Vector3(1, 1, 1);
  for (var k = 0; k < n; k++){
    M.compose(new THREE.Vector3(lampPts[k][0], 3.5, lampPts[k][1]), qI, one); pole.setMatrixAt(k, M);
    M.compose(new THREE.Vector3(lampPts[k][0], 7.1, lampPts[k][1]), qI, one); head.setMatrixAt(k, M);
    M.compose(new THREE.Vector3(lampPts[k][0], 0.78, lampPts[k][1]), qF, one); glow.setMatrixAt(k, M);
  }
  scene.add(pole); scene.add(head); scene.add(glow);
})();

// ---------- traffic signals ----------
var sigEWMat = new THREE.MeshStandardMaterial({color: 0x111111, emissive: 0x2aff6a, emissiveIntensity: 1.4});
var sigNSMat = new THREE.MeshStandardMaterial({color: 0x111111, emissive: 0xff3b30, emissiveIntensity: 1.4});
(function(){
  var poleG = new THREE.CylinderGeometry(0.14, 0.14, 6, 6);
  var poleM = new THREE.MeshStandardMaterial({color: 0x33363c});
  var n = EW.length * NS.length;
  var poles = new THREE.InstancedMesh(poleG, poleM, n);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  var k = 0;
  var ballG = new THREE.SphereGeometry(0.45, 8, 8);
  EW.forEach(function(e){ NS.forEach(function(nn){
    var px = nn.x - 12.4, pz = e.z + 12.4;
    M.compose(new THREE.Vector3(px, 3, pz), q, one); poles.setMatrixAt(k++, M);
    var a = new THREE.Mesh(ballG, sigEWMat); a.position.set(px, 5.6, pz); scene.add(a);
    var b = new THREE.Mesh(ballG, sigNSMat); b.position.set(px, 4.5, pz); scene.add(b);
  }); });
  scene.add(poles);
})();

// ---------- street name signs (Lexington-style green blades) ----------
var signGreenMat = new THREE.MeshStandardMaterial({color: 0x17694c, roughness: 0.6});
function drawHorseBadge(g, x, y, s){
  // navy medallion with a gold horse-head silhouette (Lexington's branding)
  g.fillStyle = '#1d2f5e'; g.fillRect(x, y, s, s);
  g.fillStyle = '#d8b04a';
  g.beginPath();                                 // neck
  g.moveTo(x + s * 0.22, y + s * 0.88);
  g.lineTo(x + s * 0.38, y + s * 0.34);
  g.lineTo(x + s * 0.62, y + s * 0.30);
  g.lineTo(x + s * 0.66, y + s * 0.88);
  g.closePath(); g.fill();
  g.beginPath();                                 // head + muzzle
  g.moveTo(x + s * 0.38, y + s * 0.40);
  g.lineTo(x + s * 0.82, y + s * 0.50);
  g.lineTo(x + s * 0.80, y + s * 0.62);
  g.lineTo(x + s * 0.42, y + s * 0.58);
  g.closePath(); g.fill();
  g.beginPath();                                 // ear
  g.moveTo(x + s * 0.42, y + s * 0.34);
  g.lineTo(x + s * 0.50, y + s * 0.12);
  g.lineTo(x + s * 0.56, y + s * 0.32);
  g.closePath(); g.fill();
}
var signTexCache = {};
function streetSignTex(name){
  if (signTexCache[name]) return signTexCache[name];
  var t = makeTex(256, 64, function(g){
    g.fillStyle = '#17694c'; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 5;
    g.strokeRect(5, 5, 246, 54);
    drawHorseBadge(g, 14, 14, 36);
    g.fillStyle = '#f6f6f0';
    g.font = 'bold 27px Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(name, 62, 34, 180);
  });
  t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  signTexCache[name] = t;
  return t;
}
(function(){
  var bladeG = new THREE.BoxGeometry(2.7, 0.6, 0.06);
  var poleG = new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6);
  var poles = new THREE.InstancedMesh(poleG, signGreenMat, EW.length * NS.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  var k = 0;
  EW.forEach(function(e){ NS.forEach(function(nn){
    var px = nn.x + 12.6, pz = e.z - 12.6;
    M.compose(new THREE.Vector3(px, 2.3, pz), q, one);
    poles.setMatrixAt(k++, M);
    var texA = new THREE.MeshStandardMaterial({map: streetSignTex(e.name), roughness: 0.55});
    var a = new THREE.Mesh(bladeG, [signGreenMat, signGreenMat, signGreenMat, signGreenMat, texA, texA]);
    a.position.set(px, 4.3, pz); scene.add(a);         // EW blade reads N/S
    var texB = new THREE.MeshStandardMaterial({map: streetSignTex(nn.name), roughness: 0.55});
    var b = new THREE.Mesh(bladeG, [signGreenMat, signGreenMat, signGreenMat, signGreenMat, texB, texB]);
    b.position.set(px, 3.8, pz); b.rotation.y = Math.PI / 2; scene.add(b);
  }); });
  scene.add(poles);
})();

// ---------- cars ----------
var CAR_COLS = [0xc8ccd2, 0x22262c, 0x7a1f2b, 0x274a68, 0x8c8f4a, 0x3a3f47, 0xb0722a, 0xe0e3e8]
  .map(function(c){ return new THREE.MeshStandardMaterial({color: c, roughness: 0.45, metalness: 0.35}); });
var cabMat = new THREE.MeshStandardMaterial({color: 0x14171c, roughness: 0.2, metalness: 0.4});
var headMat = new THREE.MeshStandardMaterial({color: 0x1a1a14, emissive: 0xfff2cc, emissiveIntensity: 0.1});
var tailMat = new THREE.MeshStandardMaterial({color: 0x1a0f0f, emissive: 0xff3326, emissiveIntensity: 0.1});
var bodyG = new THREE.BoxGeometry(4.6, 1.1, 2.0);
var cabG = new THREE.BoxGeometry(2.4, 0.85, 1.8);
var lightG = new THREE.BoxGeometry(0.18, 0.28, 1.7);

var vehicles = [];   // every enterable car: {g, ai:carRef|null, th, spd}
// static parked cars in the surface lots (enterable)
parkedPts.forEach(function(p){
  var g = new THREE.Group();
  var body = new THREE.Mesh(bodyG, CAR_COLS[(Math.random() * CAR_COLS.length) | 0]);
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  var cab = new THREE.Mesh(cabG, cabMat); cab.position.set(-0.25, 1.55, 0); g.add(cab);
  g.position.set(p[0], 0.72, p[1]); g.rotation.y = p[2];
  scene.add(g);
  vehicles.push({g: g, ai: null, th: p[2], spd: 0});
});

var lanes = [];   // {axis, along-street coord fixed, dir, cars: []}
EW.forEach(function(s){
  s.dirs.forEach(function(d, di){
    var off = s.dirs.length === 1 ? (di === 0 ? -3.6 : 3.6) : d * 3.6;
    if (s.dirs.length === 1) { lanes.push({axis: 'x', c: s.z - 3.6, dir: d, cars: []});
                               lanes.push({axis: 'x', c: s.z + 3.6, dir: d, cars: []}); }
    else lanes.push({axis: 'x', c: s.z + d * 3.6, dir: d, cars: []});
  });
});
NS.forEach(function(s){
  if (s.dirs.length === 1){
    lanes.push({axis: 'z', c: s.x - 3.6, dir: s.dirs[0], cars: []});
    lanes.push({axis: 'z', c: s.x + 3.6, dir: s.dirs[0], cars: []});
  } else s.dirs.forEach(function(d){
    lanes.push({axis: 'z', c: s.x - d * 3.6, dir: d, cars: []});
  });
});

var cars = [];
lanes.forEach(function(L){
  var lo = L.axis === 'x' ? X0 : Z0, hi = L.axis === 'x' ? X1 : Z1;
  var count = 3;
  for (var k = 0; k < count; k++){
    var g = new THREE.Group();
    var body = new THREE.Mesh(bodyG, CAR_COLS[(Math.random() * CAR_COLS.length) | 0]);
    body.position.y = 0.75; body.castShadow = true; g.add(body);
    var cab = new THREE.Mesh(cabG, cabMat); cab.position.set(-0.25, 1.55, 0); g.add(cab);
    var hl = new THREE.Mesh(lightG, headMat); hl.position.set(2.32, 0.75, 0); g.add(hl);
    var tl = new THREE.Mesh(lightG, tailMat); tl.position.set(-2.32, 0.8, 0); g.add(tl);
    g.rotation.y = L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : (L.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    scene.add(g);
    var car = {g: g, lane: L, s: lo + (k + Math.random() * 0.6) * (hi - lo) / count,
               v: 0, vt: 10 + Math.random() * 4, id: 'CAR-' + ('0' + (cars.length + 1)).slice(-2),
               trail: [], tt: 0};
    L.cars.push(car); cars.push(car);
    vehicles.push({g: g, ai: car, th: g.rotation.y, spd: 0});
  }
});
function placeCar(c){
  if (c.lane.axis === 'x') c.g.position.set(c.s, 0.15, c.lane.c);
  else c.g.position.set(c.lane.c, 0.15, c.s);
}
cars.forEach(placeCar);

var crossEW = NS.map(function(s){ return s.x; });   // cross coords for EW lanes
var crossNS = EW.map(function(s){ return s.z; });

var CYCLE = 26;
function ewGreen(t){ return (t % CYCLE) < 11; }
function nsGreen(t){ var p = t % CYCLE; return p >= 13 && p < 24; }

function updateCars(dt, tNow){
  var green = {x: ewGreen(tNow), z: nsGreen(tNow)};
  lanes.forEach(function(L){
    var lo = L.axis === 'x' ? X0 : Z0, hi = L.axis === 'x' ? X1 : Z1;
    var crosses = L.axis === 'x' ? crossEW : crossNS;
    L.cars.forEach(function(c){
      var desired = c.vt;
      // signal ahead
      if (!green[L.axis]){
        var best = 1e9;
        for (var k = 0; k < crosses.length; k++){
          var stopAt = crosses[k] - L.dir * (SW / 2 + 4);
          var d = (stopAt - c.s) * L.dir;
          if (d > -1 && d < best) best = d;
        }
        if (best < 30) desired = Math.min(desired, Math.max(0, (best - 1.5) * 1.1));
      }
      // car-following
      var gap = 1e9;
      L.cars.forEach(function(o){
        if (o === c) return;
        var d = (o.s - c.s) * L.dir;
        if (d > 0 && d < gap) gap = d;
      });
      if (gap < 26) desired = Math.min(desired, Math.max(0, (gap - 7) * 1.2));
      c.v += Math.max(-16 * dt, Math.min(6 * dt, desired - c.v));
      c.s += L.dir * c.v * dt;
      if (c.s > hi){ c.s = lo; c.trail.length = 0; }
      if (c.s < lo){ c.s = hi; c.trail.length = 0; }
      placeCar(c);
      c.tt += dt;
      if (c.tt > 0.35){
        c.tt = 0;
        c.trail.push([c.g.position.x, c.g.position.z]);
        if (c.trail.length > 16) c.trail.shift();
      }
    });
  });
}

// ---------- pedestrians ----------
var PED_COLS = [0xc7cdd6, 0x8f2f3c, 0x2f5d8f, 0xc9a44a, 0x4a7a52, 0x6b4a8f, 0xd97940, 0x39404a]
  .map(function(c){ return new THREE.MeshStandardMaterial({color: c, roughness: 0.85}); });
var skinMat = new THREE.MeshStandardMaterial({color: 0xc99e7e, roughness: 0.8});
var pedBodyG = new THREE.CapsuleGeometry(0.32, 0.8, 3, 8);
var pedHeadG = new THREE.SphereGeometry(0.22, 8, 8);
var peds = [];
var pedStreets = [];
EW.forEach(function(s){ if (s.z >= -300 && s.z <= 200) pedStreets.push({axis: 'x', c: s.z}); });
NS.forEach(function(s){ pedStreets.push({axis: 'z', c: s.x}); });
for (var pk = 0; pk < 46; pk++){
  var st = pedStreets[(Math.random() * pedStreets.length) | 0];
  var side = Math.random() < 0.5 ? -11 : 11;
  var g = new THREE.Group();
  var body = new THREE.Mesh(pedBodyG, PED_COLS[(Math.random() * PED_COLS.length) | 0]);
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  var head = new THREE.Mesh(pedHeadG, skinMat); head.position.y = 1.55; g.add(head);
  scene.add(g);
  var lo = st.axis === 'x' ? -230 : -320, hi = st.axis === 'x' ? 230 : 230;
  peds.push({g: g, axis: st.axis, c: st.c + side, s: lo + Math.random() * (hi - lo),
             lo: lo, hi: hi, dir: Math.random() < 0.5 ? 1 : -1,
             sp: 1.1 + Math.random() * 0.9, ph: Math.random() * 6,
             id: 'PED-' + ('0' + (pk + 1)).slice(-2)});
}
function updatePeds(dt, t){
  peds.forEach(function(p){
    p.s += p.dir * p.sp * dt;
    if (p.s > p.hi){ p.s = p.hi; p.dir = -1; }
    if (p.s < p.lo){ p.s = p.lo; p.dir = 1; }
    if (Math.random() < 0.002) p.dir *= -1;
    var bob = Math.abs(Math.sin(t * p.sp * 3 + p.ph)) * 0.08;
    if (p.axis === 'x'){ p.g.position.set(p.s, 0.72 + bob, p.c); p.g.rotation.y = p.dir > 0 ? 0 : Math.PI; }
    else { p.g.position.set(p.c, 0.72 + bob, p.s); p.g.rotation.y = p.dir > 0 ? -Math.PI / 2 : Math.PI / 2; }
  });
}

// ---------- player avatar (blocky, Roblox-style) ----------
var faceTex = makeTex(64, 64, function(g){
  g.fillStyle = '#f0c14b'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1b1b1b';
  g.fillRect(17, 20, 8, 11); g.fillRect(39, 20, 8, 11);
  g.fillRect(20, 44, 24, 5); g.fillRect(15, 40, 6, 5); g.fillRect(43, 40, 6, 5);
});
faceTex.encoding = THREE.sRGBEncoding;
function makeAvatar(torsoCol, legCol){
  var g = new THREE.Group();
  var skin = new THREE.MeshStandardMaterial({color: 0xf0c14b, roughness: 0.8});
  var torso = new THREE.MeshStandardMaterial({color: torsoCol, roughness: 0.8});
  var leg = new THREE.MeshStandardMaterial({color: legCol, roughness: 0.8});
  var faceMat = new THREE.MeshStandardMaterial({map: faceTex, roughness: 0.8});
  var t = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.15, 0.65), torso);
  t.position.y = 1.52; t.castShadow = true; g.add(t);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.78),
    [skin, skin, skin, skin, faceMat, skin]);
  head.position.y = 2.5; head.castShadow = true; g.add(head);
  function limb(w, px, py, mat){
    var pivot = new THREE.Group(); pivot.position.set(px, py, 0);
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.55), mat);
    m.position.y = -0.5; m.castShadow = true; pivot.add(m); g.add(pivot);
    return pivot;
  }
  var av = {g: g,
    armL: limb(0.45, -0.9, 2.05, skin), armR: limb(0.45, 0.9, 2.05, skin),
    legL: limb(0.55, -0.35, 1.0, leg),  legR: limb(0.55, 0.35, 1.0, leg)};
  // nerf blaster in the right hand (visible only when PvP is on)
  var gun = new THREE.Group();
  var gBody = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.85),
    new THREE.MeshStandardMaterial({color: 0x2f6fd4, roughness: 0.55}));
  gBody.position.set(0, -0.9, 0.42); gun.add(gBody);
  var gTip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.32, 8),
    new THREE.MeshStandardMaterial({color: 0xff7a1a, roughness: 0.5}));
  gTip.rotation.x = Math.PI / 2; gTip.position.set(0, -0.9, 0.95); gun.add(gTip);
  gun.visible = false;
  av.armR.add(gun);
  av.gun = gun;
  // freeze ice cube
  var ice = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.1, 1.9),
    new THREE.MeshStandardMaterial({color: 0x9adfff, transparent: true, opacity: 0.4,
      roughness: 0.15, metalness: 0.1}));
  ice.position.y = 1.45; ice.visible = false; g.add(ice);
  av.ice = ice;
  // jetpack (face is on +z, so the pack rides at -z)
  var pack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.95, 0.38),
    new THREE.MeshStandardMaterial({color: 0x6a6f76, roughness: 0.5, metalness: 0.35}));
  pack.position.set(0, 1.7, -0.52); g.add(pack);
  var flameG = new THREE.ConeGeometry(0.2, 0.9, 8);
  var flameMat = new THREE.MeshBasicMaterial({color: 0xffa03a, transparent: true, opacity: 0.9});
  av.flames = [-0.22, 0.22].map(function(fx){
    var f = new THREE.Mesh(flameG, flameMat);
    f.rotation.x = Math.PI;
    f.position.set(fx, 0.85, -0.52);
    f.visible = false; g.add(f);
    return f;
  });
  g.scale.setScalar(0.85);
  scene.add(g);
  return av;
}
function setSwing(av, phase, amp){
  var s = Math.sin(phase) * amp;
  av.armL.rotation.x = s; av.armR.rotation.x = -s;
  av.legL.rotation.x = -s; av.legR.rotation.x = s;
}
function angDelta(a, b){ return ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; }
// Ground height at a point: slabs, plus any roof at or below yRef (so the
// jetpack can land on rooftops but street-level walkers only see slabs).
function groundY(x, z, yRef){
  var y = 0, k;
  for (k = 0; k < slabRects.length; k++){
    var s = slabRects[k];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1){ y = 0.7; break; }
  }
  if (yRef === undefined) return y;
  for (k = 0; k < colliders.length; k++){
    var c = colliders[k];
    if (c.h > yRef + 0.5 || c.h <= y) continue;
    if (c.ell){
      var ex = (x - c.cx) / c.rx, ez = (z - c.cz) / c.rz;
      if (ex * ex + ez * ez < 1) y = c.h;
    } else if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) y = c.h;
  }
  return y;
}
// Push a point out of building footprints; anything at/above a roof is skipped
// so flight over downtown works.
function collide(p, r, y){
  y = y || 0;
  for (var k = 0; k < colliders.length; k++){
    var c = colliders[k];
    if (y >= c.h - 0.2) continue;
    if (c.ell){
      var ex = (p.x - c.cx) / (c.rx + r), ez = (p.z - c.cz) / (c.rz + r);
      var d2 = ex * ex + ez * ez;
      if (d2 < 1){
        var d = Math.sqrt(d2) || 0.001;
        p.x = c.cx + (p.x - c.cx) / d; p.z = c.cz + (p.z - c.cz) / d;
      }
      continue;
    }
    if (p.x > c.x0 - r && p.x < c.x1 + r && p.z > c.z0 - r && p.z < c.z1 + r){
      var dxl = p.x - (c.x0 - r), dxr = (c.x1 + r) - p.x;
      var dzl = p.z - (c.z0 - r), dzr = (c.z1 + r) - p.z;
      var m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) p.x = c.x0 - r;
      else if (m === dxr) p.x = c.x1 + r;
      else if (m === dzl) p.z = c.z0 - r;
      else p.z = c.z1 + r;
    }
  }
}

// ---------- identity ----------
var PLAYER_COLS = [0x3a76c4, 0xc44b3a, 0x3f9d5a, 0xb08a2e, 0x7a4a9d, 0xd4703a];
var hashStr = location.hash || '';
function cleanName(s){
  return (s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 14).toUpperCase();
}
var nameM = /name=([^&#]+)/.exec(hashStr);
var savedName = '';
try { savedName = localStorage.getItem('lt_name') || ''; } catch (e){}
var myName = cleanName(nameM ? decodeURIComponent(nameM[1]) : savedName)
          || 'LEX-' + (100 + ((Math.random() * 900) | 0));
var myColor = PLAYER_COLS[(Math.random() * PLAYER_COLS.length) | 0];
var myId = 'ME';

// ---------- local player ----------
var player = {x: 14, y: 0, z: -9.5, vy: 0, ry: -Math.PI / 2, phase: 0, swing: 0,
              grounded: true, moving: 0, fuel: 100, thrusting: false, veh: null,
              pvp: false, frozenUntil: 0,
              av: makeAvatar(myColor, 0x3f7d3f)};
function isFrozen(){ return performance.now() < player.frozenUntil; }

// ---------- nerf darts ----------
var darts = [];
var dartGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8);
var dartMat = new THREE.MeshStandardMaterial({color: 0x2f6fd4, roughness: 0.6});
var dartTipMat = new THREE.MeshStandardMaterial({color: 0xff7a1a, roughness: 0.4});
var lastFire = 0;
function spawnDart(ox, oy, oz, dx, dy, dz, mine){
  var g = new THREE.Group();
  var body = new THREE.Mesh(dartGeo, dartMat);
  body.rotation.x = Math.PI / 2; g.add(body);
  var tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), dartTipMat);
  tip.position.z = 0.22; g.add(tip);
  g.position.set(ox, oy, oz);
  g.lookAt(ox + dx, oy + dy, oz + dz);
  scene.add(g);
  darts.push({g: g, vx: dx * 38, vy: dy * 38, vz: dz * 38,
              born: performance.now(), mine: !!mine});
}
function setPvp(on){
  if (player.pvp === on) return;
  player.pvp = on;
  player.av.gun.visible = on;
  syncBtns();
}
var _aim = new THREE.Vector3();
function fireDart(){
  if (mode !== 'player' || player.veh || isFrozen()) return;
  if (!player.pvp){ setPvp(true); return; }   // first press draws = opts in
  var now = performance.now();
  if (now - lastFire < 450) return;
  lastFire = now;
  camera.getWorldDirection(_aim);
  player.ry = Math.atan2(_aim.x, _aim.z);     // face where you shoot
  var ox, oy, oz;
  if (ads){   // spawn on the reticle ray so ADS shots land where the dot is
    ox = camera.position.x + _aim.x * 6;
    oy = camera.position.y + _aim.y * 6;
    oz = camera.position.z + _aim.z * 6;
  } else {
    ox = player.x + _aim.x * 1.1;
    oy = player.y + 1.7 + _aim.y * 1.1;
    oz = player.z + _aim.z * 1.1;
  }
  spawnDart(ox, oy, oz, _aim.x, _aim.y, _aim.z, true);
  if (online && ws && ws.readyState === 1)
    ws.send(JSON.stringify({t: 'shot',
      ox: +ox.toFixed(1), oy: +oy.toFixed(1), oz: +oz.toFixed(1),
      dx: +_aim.x.toFixed(3), dy: +_aim.y.toFixed(3), dz: +_aim.z.toFixed(3)}));
}
function pointInBuilding(x, y, z){
  for (var k = 0; k < colliders.length; k++){
    var c = colliders[k];
    if (y >= c.h) continue;
    if (c.ell){
      var ex = (x - c.cx) / c.rx, ez = (z - c.cz) / c.rz;
      if (ex * ex + ez * ez < 1) return true;
    } else if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return true;
  }
  return false;
}
function updateDarts(dt){
  var now = performance.now();
  for (var i = darts.length - 1; i >= 0; i--){
    var d = darts[i];
    d.vy -= 6 * dt;   // foam-dart droop
    d.g.position.x += d.vx * dt;
    d.g.position.y += d.vy * dt;
    d.g.position.z += d.vz * dt;
    var p = d.g.position;
    var dead = now - d.born > 2000 || p.y < 0.05 || pointInBuilding(p.x, p.y, p.z);
    if (!dead && d.mine){
      for (var id in remotes){
        var r = remotes[id];
        if (!r.p) continue;                                   // not opted in
        if (r.frozenUntil && now < r.frozenUntil) continue;   // already frozen
        var rp = r.av.g.position;
        var dx = p.x - rp.x, dy = p.y - (rp.y + 1.3), dz = p.z - rp.z;
        if (dx * dx + dz * dz < 0.85 && dy * dy < 2.6){
          dead = true;
          if (online && ws && ws.readyState === 1)
            ws.send(JSON.stringify({t: 'hit', target: id}));
          else {   // offline: freeze bots locally
            r.frozenUntil = now + 4000;
            var bot = bots.filter(function(b){ return b.id === id; })[0];
            if (bot) bot.frozenUntil = now + 4000;
          }
          break;
        }
      }
    }
    if (dead){ scene.remove(d.g); darts.splice(i, 1); }
  }
}
var rigP = {az: Math.PI / 2, el: 0.32, r: 13};
var jumpQueued = false;
var mode = 'player';   // 'player' | 'drone'
function nearestVehicle(){
  var best = null, bd = 42; // 6.5m squared-ish
  for (var k = 0; k < vehicles.length; k++){
    var g = vehicles[k].g;
    var dx = g.position.x - player.x, dz = g.position.z - player.z;
    var d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = vehicles[k]; }
  }
  return best;
}
function tryEnterExit(){
  if (mode !== 'player') return;
  if (player.veh){
    var v = player.veh;
    var px = v.g.position.x + Math.sin(v.th) * 3.4;
    var pz = v.g.position.z + Math.cos(v.th) * 3.4;
    player.veh = null;
    player.av.g.visible = true;
    player.x = px; player.z = pz;
    player.y = groundY(px, pz, player.y + 1); player.vy = 0;
    collide(player, 0.55, player.y);
    return;
  }
  if (!player.grounded) return;
  var nv = nearestVehicle();
  if (!nv) return;
  if (nv.ai && nv.ai.lane){
    var idx = nv.ai.lane.cars.indexOf(nv.ai);
    if (idx >= 0) nv.ai.lane.cars.splice(idx, 1);
    nv.ai.lane = null;
  }
  nv.th = nv.g.rotation.y;
  nv.spd = nv.ai ? nv.ai.v || 0 : 0;
  player.veh = nv;
  player.av.g.visible = false;
  rigP.r = Math.max(rigP.r, 17);
}
function updateDrive(dt){
  var v = player.veh;
  var fwd = keysDown.w || keysDown.arrowup, back = keysDown.s || keysDown.arrowdown;
  var left = keysDown.a || keysDown.arrowleft, right = keysDown.d || keysDown.arrowright;
  if (stick.active){ fwd = stick.y < -0.25; back = stick.y > 0.25;
                     left = stick.x < -0.3; right = stick.x > 0.3; }
  if (isFrozen()){ fwd = back = left = right = false; }
  if (fwd) v.spd += 13 * dt;
  else if (back) v.spd -= 20 * dt;
  else v.spd -= Math.sign(v.spd) * Math.min(Math.abs(v.spd), (2 + Math.abs(v.spd) * 0.35) * dt);
  v.spd = Math.max(-9, Math.min(30, v.spd));
  var st = (left ? 1 : 0) - (right ? 1 : 0);
  v.th += st * Math.min(1, Math.abs(v.spd) / 9) * 1.7 * dt * (v.spd >= 0 ? 1 : -1);
  var fx = Math.cos(v.th), fz = -Math.sin(v.th);
  var p = {x: v.g.position.x + fx * v.spd * dt, z: v.g.position.z + fz * v.spd * dt};
  var ox = p.x, oz = p.z;
  collide(p, 1.8, 0);
  if (p.x !== ox || p.z !== oz) v.spd *= 0.2;   // crunch
  p.x = Math.max(X0 - 20, Math.min(X1 + 20, p.x));
  p.z = Math.max(Z0 - 20, Math.min(Z1 + 20, p.z));
  var gy = groundY(p.x, p.z);
  v.g.position.set(p.x, gy + 0.15, p.z);
  v.g.rotation.y = v.th;
  player.x = p.x; player.z = p.z; player.y = gy;
  player.moving = Math.abs(v.spd);
  player.thrusting = false;
  player.fuel = Math.min(100, player.fuel + 30 * dt);
}
function updatePlayer(dt){
  player.av.ice.visible = isFrozen();
  if (player.veh && mode === 'player'){ updateDrive(dt); return; }
  var f = 0, r = 0;
  if (mode === 'player' && !isFrozen()){
    if (keysDown.w || keysDown.arrowup) f += 1;
    if (keysDown.s || keysDown.arrowdown) f -= 1;
    if (keysDown.d || keysDown.arrowright) r += 1;
    if (keysDown.a || keysDown.arrowleft) r -= 1;
    if (stick.active){ f = -stick.y; r = stick.x; }
  }
  var sp = keysDown.shift ? 13.5 : 7.5;
  if (!player.grounded && player.thrusting) sp = 15;
  var mag = Math.hypot(f, r);
  if (mag > 0.15){
    f /= Math.max(1, mag); r /= Math.max(1, mag);
    var sn = Math.sin(rigP.az), cs = Math.cos(rigP.az);
    var mx = -f * sn + r * cs, mz = -f * cs - r * sn;
    player.x += mx * sp * dt; player.z += mz * sp * dt;
    player.ry += angDelta(player.ry, Math.atan2(mx, mz)) * Math.min(1, dt * 11);
    player.phase += dt * sp * 1.7;
    player.moving = sp;
  } else player.moving = 0;
  collide(player, 0.55, player.y);
  player.x = Math.max(X0 - 20, Math.min(X1 + 20, player.x));
  player.z = Math.max(Z0 - 20, Math.min(Z1 + 20, player.z));
  var gy = groundY(player.x, player.z, player.y);
  if ((keysDown[' '] || jumpQueued) && player.grounded && mode === 'player' && !isFrozen()){
    player.vy = 11.5; player.grounded = false;
  }
  jumpQueued = false;
  // jetpack: hold space while airborne
  var thrusting = false;
  if (!player.grounded && (keysDown[' '] || stick.jets) && player.fuel > 0.5 && mode === 'player'){
    player.vy += 55 * dt;
    if (player.vy > 13) player.vy = 13;
    player.fuel -= 9 * dt;
    thrusting = true;
  }
  player.thrusting = thrusting;
  if (player.grounded) player.fuel = Math.min(100, player.fuel + 30 * dt);
  player.vy -= 30 * dt;
  player.y += player.vy * dt;
  if (player.y > 185){ player.y = 185; if (player.vy > 0) player.vy = 0; }
  if (player.y <= gy && player.vy <= 0){
    player.y = gy; player.vy = 0; player.grounded = true;
  } else if (player.grounded && player.y < gy + 0.71){
    player.y = gy;   // step up curbs
  } else player.grounded = false;
  player.swing += (Math.min(0.8, player.moving / 12) - player.swing) * Math.min(1, dt * 8);
  setSwing(player.av, player.phase, player.swing);
  if (!player.grounded){ player.av.armL.rotation.x = -2.6; player.av.armR.rotation.x = -2.6; }
  if (player.pvp && player.grounded) player.av.armR.rotation.x = -1.35;  // aiming pose
  player.av.flames.forEach(function(fl){ fl.visible = thrusting; });
  player.av.g.position.set(player.x, player.y, player.z);
  player.av.g.rotation.y = player.ry;
}
var camR = 13, aimBlend = 0;
function updatePlayerCam(dt){
  followPause -= dt;
  // soft follow: settle behind the character/car when the mouse is idle
  if (followPause <= 0){
    var tAz = null;
    if (player.veh)
      tAz = Math.atan2(Math.cos(player.veh.th), -Math.sin(player.veh.th)) + Math.PI;
    else if (player.moving > 0)
      tAz = player.ry + Math.PI;
    if (tAz !== null)
      rigP.az += angDelta(rigP.az, tAz) * Math.min(1, dt * (player.veh ? 1.7 : 2.1));
  }
  rigP.el = Math.max(-0.15, Math.min(1.35, rigP.el));
  rigP.r = Math.max(4, Math.min(90, rigP.r));
  var aiming = ads && player.pvp && !player.veh;
  aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * 9);
  camR += ((aiming ? 4.4 : rigP.r) - camR) * Math.min(1, dt * 9);
  var tf = aiming ? 42 : 55;
  if (Math.abs(camera.fov - tf) > 0.05){
    camera.fov += (tf - camera.fov) * Math.min(1, dt * 9);
    camera.updateProjectionMatrix();
  }
  // over-the-shoulder shift while aiming so the reticle clears the head
  var offX = Math.cos(rigP.az) * 1.25 * aimBlend;
  var offZ = -Math.sin(rigP.az) * 1.25 * aimBlend;
  var offY = 0.4 * aimBlend;
  camera.position.set(
    player.x + offX + camR * Math.cos(rigP.el) * Math.sin(rigP.az),
    player.y + 1.6 + offY + camR * Math.sin(rigP.el),
    player.z + offZ + camR * Math.cos(rigP.el) * Math.cos(rigP.az));
  camera.lookAt(player.x + offX, player.y + 2.2 + offY, player.z + offZ);
}

// ---------- net layer (WebSocket or local bot sim) ----------
var remotes = {};   // id -> {av, name, buf, phase, swing, lastSeen, lx, lz, ry}
var ws = null, online = false;
function peerCount(){ return Object.keys(remotes).length; }
function setNetChip(){
  document.getElementById('netchip').textContent =
    'NET: ' + (online ? 'ONLINE' : 'LOCAL-SIM') + ' · PEERS ' + peerCount();
}
function removeRemote(id){
  var r = remotes[id];
  if (r){
    scene.remove(r.av.g);
    if (r.carG) scene.remove(r.carG);
    delete remotes[id]; setNetChip();
  }
}
function buildRemoteCar(color){
  var g = new THREE.Group();
  var body = new THREE.Mesh(bodyG, new THREE.MeshStandardMaterial({
    color: color, roughness: 0.45, metalness: 0.35}));
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  var cab = new THREE.Mesh(cabG, cabMat); cab.position.set(-0.25, 1.55, 0); g.add(cab);
  var hl = new THREE.Mesh(lightG, headMat); hl.position.set(2.32, 0.75, 0); g.add(hl);
  var tl = new THREE.Mesh(lightG, tailMat); tl.position.set(-2.32, 0.8, 0); g.add(tl);
  scene.add(g);
  return g;
}
function handleNet(m){
  if (m.t === 'welcome'){
    myId = m.id; online = true;
    Object.keys(remotes).forEach(function(id){ if (id.indexOf('BOT') === 0) removeRemote(id); });
    (m.peers || []).forEach(handleNet);
    setNetChip();
  } else if (m.t === 'state'){
    if (m.id === myId) return;
    var r = remotes[m.id];
    if (!r){
      r = remotes[m.id] = {av: makeAvatar(m.c || 0x3a76c4, 0x555a63), name: m.n || m.id,
        c: m.c || 0x3a76c4, m: 0, carG: null,
        buf: [], phase: Math.random() * 6, swing: 0, lx: m.x, lz: m.z, ry: m.ry || 0};
      setNetChip();
    }
    r.m = m.m | 0;
    r.p = m.p | 0;
    if (m.n && m.n !== r.name) r.name = m.n;   // live rename
    r.buf.push({t: performance.now(), x: m.x, y: m.y, z: m.z, ry: m.ry || 0});
    if (r.buf.length > 12) r.buf.shift();
    r.lastSeen = performance.now();
  } else if (m.t === 'chat'){
    var who = m.id === myId ? myName : (remotes[m.id] ? remotes[m.id].name : (m.n || m.id));
    addChatLine(who, m.msg, m.id === myId);
    var bubble = {msg: m.msg, until: performance.now() + 6000};
    if (m.id === myId) myBubble = bubble;
    else if (remotes[m.id]) remotes[m.id].bubble = bubble;
  } else if (m.t === 'correct'){
    // server rejected our movement — snap back to the last accepted position
    player.x = m.x; player.y = m.y; player.z = m.z; player.vy = 0;
  } else if (m.t === 'frozen'){
    var until = performance.now() + (typeof m.dur === 'number' ? m.dur : 4000);
    if (m.id === myId) player.frozenUntil = m.dur === 0 ? 0 : until;
    else if (remotes[m.id]) remotes[m.id].frozenUntil = m.dur === 0 ? 0 : until;
  } else if (m.t === 'shot'){
    if (m.id !== myId)
      spawnDart(m.ox, m.oy, m.oz, m.dx, m.dy, m.dz, false);
  } else if (m.t === 'sys'){
    addChatLine('⚙ SERVER', String(m.msg || ''), false);
  } else if (m.t === 'leave') removeRemote(m.id);
}

// ---------- chat ----------
var myBubble = null;
var chatLog = document.getElementById('chatlog');
var chatIn = document.getElementById('chatin');
function addChatLine(who, msg, self){
  var div = document.createElement('div');
  var w = document.createElement('span'); w.className = 'who';
  w.textContent = who + ': ';
  if (self) w.style.color = '#8ef7ff';
  div.appendChild(w);
  div.appendChild(document.createTextNode(msg));
  chatLog.appendChild(div);
  while (chatLog.children.length > 8) chatLog.removeChild(chatLog.firstChild);
}
function sendChat(){
  var msg = chatIn.value.trim().slice(0, 120);
  chatIn.value = '';
  chatIn.blur();
  if (!msg) return;
  if (online && ws && ws.readyState === 1){
    ws.send(JSON.stringify({t: 'chat', msg: msg}));   // server echoes it back
  } else {
    addChatLine(myName, msg, true);
    myBubble = {msg: msg, until: performance.now() + 6000};
  }
}
chatIn.addEventListener('focus', function(){ keysDown = {}; });
function updateRemotes(dt){
  var now = performance.now(), rt = now - 160;
  for (var id in remotes){
    var r = remotes[id];
    if (now - r.lastSeen > 8000){ removeRemote(id); continue; }
    var buf = r.buf;
    if (!buf.length) continue;
    while (buf.length >= 2 && buf[1].t <= rt) buf.shift();
    var a = buf[0], b = buf.length > 1 ? buf[1] : a;
    var f = b.t > a.t ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t))) : 1;
    var x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
    var spd = Math.hypot(x - r.lx, z - r.lz) / Math.max(dt, 0.001);
    r.lx = x; r.lz = z;
    r.ry += angDelta(r.ry, a.ry + angDelta(a.ry, b.ry) * f) * Math.min(1, dt * 10);
    r.phase += dt * Math.min(spd, 14) * 1.7;
    r.swing += (Math.min(0.8, spd / 12) - r.swing) * Math.min(1, dt * 8);
    if (r.m === 2){        // driving: render their car, hide the avatar
      if (!r.carG) r.carG = buildRemoteCar(r.c);
      r.carG.visible = true; r.av.g.visible = false;
      r.carG.position.set(x, y + 0.15, z);
      r.carG.rotation.y = r.ry;
    } else {
      if (r.carG) r.carG.visible = false;
      r.av.g.visible = true;
      setSwing(r.av, r.phase, r.swing);
      r.av.flames.forEach(function(fl){ fl.visible = r.m === 1; });
      if (r.m === 1){ r.av.armL.rotation.x = -2.6; r.av.armR.rotation.x = -2.6; }
      r.av.gun.visible = !!r.p;
      if (r.p && r.m !== 1) r.av.armR.rotation.x = -1.35;
      r.av.ice.visible = !!(r.frozenUntil && now < r.frozenUntil);
      r.av.g.position.set(x, y, z);
      r.av.g.rotation.y = r.ry;
    }
  }
}
// WebSocket: #ws=1 -> same origin; #ws=<url> -> explicit. Default: try same origin when http(s).
(function(){
  var wsM = /ws=([^&#]+)/.exec(hashStr);
  var url = null;
  if (wsM) url = wsM[1] === '1'
    ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
    : decodeURIComponent(wsM[1]);
  else if (location.protocol === 'http:' || location.protocol === 'https:')
    url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  if (!url) return;
  try { ws = new WebSocket(url); } catch (e){ ws = null; return; }
  ws.onmessage = function(ev){ try { handleNet(JSON.parse(ev.data)); } catch (e){} };
  ws.onclose = ws.onerror = function(){
    if (online){ online = false; setNetChip(); }
    ws = null;
  };
})();
var netAcc = 0;
function netTick(dt){
  netAcc += dt;
  if (netAcc < 0.1) return;
  netAcc = 0;
  if (online && ws && ws.readyState === 1)
    ws.send(JSON.stringify({t: 'state', n: myName, c: myColor,
      m: player.veh ? 2 : (player.thrusting ? 1 : 0),
      p: player.pvp ? 1 : 0,
      x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2),
      ry: +(player.veh ? player.veh.th : player.ry).toFixed(3)}));
}

// ---------- local bots (stand-ins so the MMO pipeline always runs) ----------
var BOT_DEFS = [
  {id: 'BOT-1', n: 'WILDCAT-22', c: 0xc44b3a},
  {id: 'BOT-2', n: 'BLUEGRASS-7', c: 0x3f9d5a},
  {id: 'BOT-3', n: 'TRK-HORSE', c: 0x7a4a9d}
];
var bots = BOT_DEFS.map(function(d, k){
  var st = pedStreets[(Math.random() * pedStreets.length) | 0];
  return {id: d.id, n: d.n, c: d.c, axis: st.axis, c2: st.c + (Math.random() < 0.5 ? -11 : 11),
    s: -100 + Math.random() * 200, dir: Math.random() < 0.5 ? 1 : -1,
    sp: 3.5 + Math.random() * 3, y: 0, vy: 0};
});
var botAcc = 0;
function runBots(dt){
  if (online) return;
  botAcc += dt;
  while (botAcc > 0.1){
    botAcc -= 0.1;
    bots.forEach(function(b){
      var botFrozen = b.frozenUntil && performance.now() < b.frozenUntil;
      if (!botFrozen) b.s += b.dir * b.sp * 0.1;
      var lo = b.axis === 'x' ? -230 : -320, hi = 230;
      if (b.s > hi){ b.s = hi; b.dir = -1; }
      if (b.s < lo){ b.s = lo; b.dir = 1; }
      if (Math.random() < 0.01) b.dir *= -1;
      if (b.y === 0 && Math.random() < 0.02) b.vy = 9;
      if (b.vy || b.y > 0){
        b.vy -= 30 * 0.1; b.y += b.vy * 0.1;
        if (b.y <= 0){ b.y = 0; b.vy = 0; }
      }
      var x = b.axis === 'x' ? b.s : b.c2, z = b.axis === 'x' ? b.c2 : b.s;
      var ry = b.axis === 'x' ? (b.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
                              : (b.dir > 0 ? 0 : Math.PI);
      handleNet({t: 'state', id: b.id, n: b.n, c: b.c, p: 1,
        x: x, y: b.y + groundY(x, z), z: z, ry: ry});
    });
  }
}

// ---------- day/night ----------
var KEYS = [
  {h: 0,    sky: '#100a1e', fog: '#181028', sun: 0,    night: 1,    hemi: 0.22},
  {h: 4.6,  sky: '#100a1e', fog: '#181028', sun: 0,    night: 1,    hemi: 0.22},
  {h: 6.6,  sky: '#4a3a5e', fog: '#8a5a6e', sun: 0.45, night: 0.5,  hemi: 0.4},
  {h: 9,    sky: '#8fb0d4', fog: '#c2d0e0', sun: 1.1,  night: 0,    hemi: 0.62},
  {h: 16.5, sky: '#8fb0d4', fog: '#c2d0e0', sun: 1.0,  night: 0,    hemi: 0.62},
  {h: 19,   sky: '#b06a86', fog: '#d19a8a', sun: 0.5,  night: 0.25, hemi: 0.5},
  {h: 20.4, sky: '#45204e', fog: '#6e3560', sun: 0.1,  night: 0.8,  hemi: 0.3},
  {h: 21.6, sky: '#100a1e', fog: '#181028', sun: 0,    night: 1,    hemi: 0.22},
  {h: 24,   sky: '#100a1e', fog: '#181028', sun: 0,    night: 1,    hemi: 0.22}
];
KEYS.forEach(function(k){ k.skyC = new THREE.Color(k.sky); k.fogC = new THREE.Color(k.fog); });
var skyC = new THREE.Color(), fogC = new THREE.Color();
function envAt(h){
  var a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (var k = 0; k < KEYS.length - 1; k++)
    if (h >= KEYS[k].h && h <= KEYS[k + 1].h){ a = KEYS[k]; b = KEYS[k + 1]; break; }
  var f = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  f = f * f * (3 - 2 * f);
  skyC.lerpColors(a.skyC, b.skyC, f);
  fogC.lerpColors(a.fogC, b.fogC, f);
  return {sun: a.sun + (b.sun - a.sun) * f, night: a.night + (b.night - a.night) * f,
          hemi: a.hemi + (b.hemi - a.hemi) * f};
}

// ---------- camera rig ----------
var rig = {t: new THREE.Vector3(-40, 0, 10), r: 330, az: 0.65, el: 0.6};
var autoCam = true;
// drone tour: Rupp -> Big Blue/Central Bank Tower -> Main St corridor ->
// courthouse square -> City Hall -> wide pull-back
var PRESETS = [
  {t: [-330, 0, 105], r: 280, el: 0.46},
  {t: [-130, 0, 50],  r: 165, el: 0.44},
  {t: [-20, 0, -5],   r: 190, el: 0.46},
  {t: [50, 0, -45],   r: 140, el: 0.48},
  {t: [168, 0, 35],   r: 155, el: 0.46},
  {t: [-40, 0, 10],   r: 370, el: 0.62}
];
var pIdx = 0, pTimer = 0, tween = null;
function startTween(){
  pIdx = (pIdx + 1) % PRESETS.length;
  var p = PRESETS[pIdx];
  tween = {t0: rig.t.clone(), t1: new THREE.Vector3(p.t[0], p.t[1], p.t[2]),
           r0: rig.r, r1: p.r, e0: rig.el, e1: p.el, f: 0};
}
function updateRig(dt){
  if (autoCam){
    rig.az += dt * 0.032;
    pTimer += dt;
    if (!tween && pTimer > 22){ pTimer = 0; startTween(); }
    if (tween){
      tween.f += dt / 7;
      var f = Math.min(1, tween.f); f = f * f * (3 - 2 * f);
      rig.t.lerpVectors(tween.t0, tween.t1, f);
      rig.r = tween.r0 + (tween.r1 - tween.r0) * f;
      rig.el = tween.e0 + (tween.e1 - tween.e0) * f;
      if (tween.f >= 1) tween = null;
    }
  }
  rig.el = Math.max(0.1, Math.min(1.45, rig.el));
  rig.r = Math.max(40, Math.min(950, rig.r));
  rig.t.x = Math.max(X0 - 120, Math.min(X1 + 120, rig.t.x));
  rig.t.z = Math.max(Z0 - 120, Math.min(Z1 + 120, rig.t.z));
  camera.position.set(
    rig.t.x + rig.r * Math.cos(rig.el) * Math.sin(rig.az),
    rig.t.y + rig.r * Math.sin(rig.el),
    rig.t.z + rig.r * Math.cos(rig.el) * Math.cos(rig.az));
  camera.lookAt(rig.t.x, rig.t.y + 6, rig.t.z);
}
function manual(){ if (autoCam){ autoCam = false; tween = null; syncBtns(); } }

// pointer controls
var drag = null;
var stick = {active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, jets: false};
var ptrLocked = false, ads = false, followPause = 0;
// pointer lock: free mouse-look in player mode; LMB fires, RMB aims
glCanvas.addEventListener('click', function(){
  if (mode === 'player' && !IS_COARSE && !ptrLocked && els.tut.hidden)
    glCanvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', function(){
  ptrLocked = document.pointerLockElement === glCanvas;
  if (!ptrLocked) ads = false;
});
document.addEventListener('mousemove', function(e){
  if (!ptrLocked || mode !== 'player') return;
  rigP.az -= e.movementX * 0.0032;
  rigP.el += e.movementY * 0.0032;
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) followPause = 1.4;
});
document.addEventListener('mousedown', function(e){
  if (!ptrLocked || mode !== 'player') return;
  if (e.button === 0) fireDart();
  if (e.button === 2 && player.pvp) ads = true;
});
document.addEventListener('mouseup', function(e){ if (e.button === 2) ads = false; });
document.addEventListener('contextmenu', function(e){ if (ptrLocked) e.preventDefault(); });
glCanvas.style.touchAction = 'none';
glCanvas.addEventListener('pointerdown', function(e){
  if (ptrLocked) return;
  if (mode === 'player' && e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.4){
    stick.active = true; stick.id = e.pointerId;
    stick.ox = e.clientX; stick.oy = e.clientY; stick.x = 0; stick.y = 0;
    glCanvas.setPointerCapture(e.pointerId);
    return;
  }
  drag = {id: e.pointerId, x: e.clientX, y: e.clientY,
          pan: mode === 'drone' && (e.shiftKey || e.button === 2)};
  glCanvas.setPointerCapture(e.pointerId);
});
glCanvas.addEventListener('pointermove', function(e){
  if (stick.active && e.pointerId === stick.id){
    stick.x = Math.max(-1, Math.min(1, (e.clientX - stick.ox) / 55));
    stick.y = Math.max(-1, Math.min(1, (e.clientY - stick.oy) / 55));
    return;
  }
  if (!drag || e.pointerId !== drag.id) return;
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (mode === 'player'){
    rigP.az -= dx * 0.0052;
    rigP.el += dy * 0.0052;
    return;
  }
  manual();
  if (drag.pan){
    var k = rig.r * 0.0016;
    rig.t.x -= (dx * Math.cos(rig.az) - dy * Math.sin(rig.az)) * k;
    rig.t.z -= (-dx * Math.sin(rig.az) - dy * Math.cos(rig.az)) * k;
  } else {
    rig.az -= dx * 0.0052;
    rig.el += dy * 0.0052;
  }
});
window.addEventListener('pointerup', function(e){
  if (stick.active && e.pointerId === stick.id){ stick.active = false; stick.x = stick.y = 0; }
  if (drag && e.pointerId === drag.id) drag = null;
});
glCanvas.addEventListener('contextmenu', function(e){ e.preventDefault(); });
glCanvas.addEventListener('wheel', function(e){
  e.preventDefault();
  if (mode === 'player'){ rigP.r *= Math.exp(e.deltaY * 0.0011); return; }
  manual();
  rig.r *= Math.exp(e.deltaY * 0.0011);
}, {passive: false});
// pinch zoom
var pinch = null;
glCanvas.addEventListener('touchstart', function(e){
  if (e.touches.length === 2)
    pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
});
glCanvas.addEventListener('touchmove', function(e){
  if (e.touches.length === 2 && pinch){
    manual();
    var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    rig.r *= pinch / d; pinch = d;
    e.preventDefault();
  }
}, {passive: false});
window.addEventListener('touchend', function(){ pinch = null; });

var keysDown = {};
window.addEventListener('keydown', function(e){
  if (e.target === chatIn){
    if (e.key === 'Escape'){ chatIn.value = ''; chatIn.blur(); }
    if (e.key === 'Enter') sendChat();
    return;
  }
  if (e.target && e.target.id === 'nameIn'){
    if (e.key === 'Enter' || e.key === 'Escape') tutClose();
    return;
  }
  if (e.key === 'Escape' && !els.tut.hidden){ tutClose(); return; }
  if (e.key === '?'){ if (els.tut.hidden) tutOpen(); else tutClose(); return; }
  if (e.key === 'Enter'){
    e.preventDefault();
    if (document.exitPointerLock) document.exitPointerLock();
    chatIn.focus(); return;
  }
  var k = e.key.toLowerCase();
  keysDown[k] = true;
  if (k === 'h'){ if (els.tut.hidden) tutOpen(); else tutClose(); }
  if (k === ' ' || k.indexOf('arrow') === 0) e.preventDefault();
  if (k === 'p') togglePause();
  if (k === 'v') toggleMode();
  if (k === 'e') tryEnterExit();
  if (k === 'g') setPvp(!player.pvp);
  if (k === 'f') fireDart();
  if (k === 'b') setToggle('box');
  if (k === 't') setToggle('trk');
  if (k === 'l') setToggle('lbl');
  if (k === 'c'){ autoCam = !autoCam; tween = null; pTimer = 0; syncBtns(); }
  if (k === '1') setSpeed(1);
  if (k === '2') setSpeed(60);
  if (k === '3') setSpeed(300);
});
window.addEventListener('keyup', function(e){ keysDown[e.key.toLowerCase()] = false; });
function toggleMode(){
  mode = mode === 'player' ? 'drone' : 'player';
  if (mode === 'player'){
    rigP.az = player.ry + Math.PI;   // camera settles behind the character
  } else if (document.exitPointerLock) document.exitPointerLock();
  syncBtns();
}
function applyWASD(dt){
  var mv = 0, ms = 0;
  if (keysDown.w) mv -= 1; if (keysDown.s) mv += 1;
  if (keysDown.a) ms -= 1; if (keysDown.d) ms += 1;
  if (mv || ms){
    manual();
    var k = rig.r * 0.65 * dt;
    rig.t.x += (mv * Math.sin(rig.az) + ms * Math.cos(rig.az)) * k;
    rig.t.z += (mv * Math.cos(rig.az) - ms * Math.sin(rig.az)) * k;
  }
}

// ---------- HUD state ----------
var show = {box: true, trk: true, lbl: true};
var simH = 19.35;
(function(){
  var m = /h=([\d.]+)/.exec(location.hash || '');
  if (m) simH = Math.min(23.99, Math.max(0, parseFloat(m[1])));
})();
var speed = 60, paused = false;
var els = {
  clock: document.getElementById('clock'), clocksub: document.getElementById('clocksub'),
  elapsed: document.getElementById('elapsed'), sig: document.getElementById('sig'),
  ncars: document.getElementById('ncars'), npeds: document.getElementById('npeds'),
  camlabel: document.getElementById('camlabel'),
  bView: document.getElementById('bView'), bJump: document.getElementById('bJump'),
  bCar: document.getElementById('bCar'), hint: document.getElementById('hint'),
  fuel: document.getElementById('fuel'), bHelp: document.getElementById('bHelp'),
  bNerf: document.getElementById('bNerf'), bFire: document.getElementById('bFire'),
  tut: document.getElementById('tut'),
  bAuto: document.getElementById('bAuto'), bBox: document.getElementById('bBox'),
  bTrk: document.getElementById('bTrk'), bLbl: document.getElementById('bLbl'),
  bPause: document.getElementById('bPause'),
  s1: document.getElementById('s1'), s60: document.getElementById('s60'), s300: document.getElementById('s300')
};
els.ncars.textContent = cars.length; els.npeds.textContent = peds.length;
function syncBtns(){
  els.bView.classList.toggle('on', mode === 'drone');
  els.bNerf.classList.toggle('on', player.pvp);
  els.bAuto.classList.toggle('on', autoCam);
  els.bBox.classList.toggle('on', show.box);
  els.bTrk.classList.toggle('on', show.trk);
  els.bLbl.classList.toggle('on', show.lbl);
  els.bPause.classList.toggle('on', paused);
  els.bPause.textContent = paused ? '>' : '||';
  els.s1.classList.toggle('on', speed === 1 && !paused);
  els.s60.classList.toggle('on', speed === 60 && !paused);
  els.s300.classList.toggle('on', speed === 300 && !paused);
  els.camlabel.textContent = mode === 'player'
    ? 'CAM-FOLLOW · ' + myName
    : 'CAM-ORBIT · ' + (autoCam ? 'AUTO' : 'MANUAL');
}
function setToggle(k){ show[k] = !show[k]; syncBtns(); }
function setSpeed(s){ speed = s; paused = false; syncBtns(); }
function togglePause(){ paused = !paused; syncBtns(); }
els.bView.onclick = toggleMode;
els.bCar.onclick = tryEnterExit;
els.bNerf.onclick = function(){ setPvp(!player.pvp); };
els.bFire.addEventListener('pointerdown', function(){ fireDart(); });
els.bJump.addEventListener('pointerdown', function(){ jumpQueued = true; stick.jets = true; });
window.addEventListener('pointerup', function(){ stick.jets = false; });
els.bAuto.onclick = function(){ autoCam = !autoCam; tween = null; pTimer = 0; syncBtns(); };
els.bBox.onclick = function(){ setToggle('box'); };
els.bTrk.onclick = function(){ setToggle('trk'); };
els.bLbl.onclick = function(){ setToggle('lbl'); };
els.bPause.onclick = togglePause;
els.s1.onclick = function(){ setSpeed(1); };
els.s60.onclick = function(){ setSpeed(60); };
els.s300.onclick = function(){ setSpeed(300); };
syncBtns();

// ---------- tutorial / about ----------
var nameIn = document.getElementById('nameIn');
nameIn.value = myName;
function applyName(){
  var n = cleanName(nameIn.value);
  if (!n || n === myName){ nameIn.value = myName; return; }
  myName = n;
  nameIn.value = n;
  try { localStorage.setItem('lt_name', n); } catch (e){}
  syncBtns();   // camlabel shows the call sign
}
function tutOpen(){
  els.tut.hidden = false; nameIn.value = myName;
  if (document.exitPointerLock) document.exitPointerLock();
}
function tutClose(){
  applyName();
  els.tut.hidden = true;
  try { localStorage.setItem('lt_tut_seen', '1'); } catch (e){}
}
els.bHelp.onclick = tutOpen;
document.getElementById('tutClose').onclick = tutClose;
document.getElementById('tutPlay').onclick = tutClose;
els.tut.addEventListener('pointerdown', function(e){ if (e.target === els.tut) tutClose(); });
(function(){
  var seen = false;
  try { seen = localStorage.getItem('lt_tut_seen') === '1'; } catch (e){}
  if (!seen) tutOpen();
})();

function dayName(h){
  if (h < 5.5 || h >= 21.5) return 'NIGHT';
  if (h < 8) return 'DAWN';
  if (h < 17) return 'DAY';
  if (h < 20.5) return 'DUSK';
  return 'NIGHT';
}

// ---------- overlay (detection boxes / tracks / labels) ----------
var ovCanvas = document.getElementById('overlay');
var ov = ovCanvas.getContext('2d');
var vw = 0, vh = 0, dpr = 1;
function resize(){
  vw = window.innerWidth; vh = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh; camera.updateProjectionMatrix();
  ovCanvas.width = vw * dpr; ovCanvas.height = vh * dpr;
  ovCanvas.style.width = vw + 'px'; ovCanvas.style.height = vh + 'px';
  ov.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

var _v = new THREE.Vector3();
function project(x, y, z){
  _v.set(x, y, z).project(camera);
  if (_v.z > 1 || _v.z < -1) return null;
  return [(_v.x + 1) / 2 * vw, (1 - _v.y) / 2 * vh];
}
var FOVK = 1 / Math.tan(camera.fov * Math.PI / 360);
function pxSize(worldSize, dist){ return worldSize / dist * (vh / 2) * FOVK; }

function bracket(x, y, w, h, col){
  var L = Math.max(3, Math.min(9, w * 0.3));
  ov.strokeStyle = col; ov.lineWidth = 1.2;
  ov.beginPath();
  ov.moveTo(x, y + L); ov.lineTo(x, y); ov.lineTo(x + L, y);
  ov.moveTo(x + w - L, y); ov.lineTo(x + w, y); ov.lineTo(x + w, y + L);
  ov.moveTo(x + w, y + h - L); ov.lineTo(x + w, y + h); ov.lineTo(x + w - L, y + h);
  ov.moveTo(x + L, y + h); ov.lineTo(x, y + h); ov.lineTo(x, y + h - L);
  ov.stroke();
}
function chip(x, y, text, col){
  ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
  var w = ov.measureText(text).width;
  ov.fillStyle = 'rgba(2,8,10,0.62)';
  ov.fillRect(x - 2, y - 9, w + 6, 12);
  ov.fillStyle = col;
  ov.fillText(text, x + 1, y);
}
var camPos = new THREE.Vector3();
function drawOverlay(){
  ov.clearRect(0, 0, vw, vh);
  camera.getWorldPosition(camPos);
  var k;
  if (stick.active){   // touch joystick
    ov.strokeStyle = 'rgba(110,247,223,0.5)'; ov.lineWidth = 2;
    ov.beginPath(); ov.arc(stick.ox, stick.oy, 40, 0, Math.PI * 2); ov.stroke();
    ov.fillStyle = 'rgba(110,247,223,0.45)';
    ov.beginPath();
    ov.arc(stick.ox + stick.x * 34, stick.oy + stick.y * 34, 16, 0, Math.PI * 2);
    ov.fill();
  }
  if (mode === 'player' && player.pvp && !player.veh){   // crosshair
    ov.fillStyle = 'rgba(255,157,90,0.95)';
    ov.fillRect(vw / 2 - 1.5, vh / 2 - 1.5, 3, 3);
    if (ads){
      ov.strokeStyle = 'rgba(255,157,90,0.8)'; ov.lineWidth = 1.2;
      ov.beginPath(); ov.arc(vw / 2, vh / 2, 11, 0, Math.PI * 2); ov.stroke();
    }
  }
  if (show.trk){
    ov.globalAlpha = 0.55;
    for (k = 0; k < cars.length; k++){
      var tr = cars[k].trail;
      if (tr.length < 2) continue;
      if (camPos.distanceTo(cars[k].g.position) > 480) continue;
      ov.strokeStyle = '#4adfd0'; ov.lineWidth = 1;
      ov.beginPath();
      var started = false;
      for (var q = 0; q < tr.length; q++){
        var pp = project(tr[q][0], 0.8, tr[q][1]);
        if (!pp){ started = false; continue; }
        if (!started){ ov.moveTo(pp[0], pp[1]); started = true; }
        else ov.lineTo(pp[0], pp[1]);
      }
      ov.stroke();
    }
    ov.globalAlpha = 1;
  }
  if (show.box){
    var drawn = 0;
    for (k = 0; k < cars.length && drawn < 26; k++){
      var c = cars[k];
      var dist = camPos.distanceTo(c.g.position);
      if (dist > 460) continue;
      var p = project(c.g.position.x, c.g.position.y + 1, c.g.position.z);
      if (!p) continue;
      var hpx = pxSize(2.4, dist), wpx = pxSize(5.2, dist);
      if (hpx < 5) continue;
      bracket(p[0] - wpx / 2, p[1] - hpx / 2, wpx, hpx, 'rgba(98,245,255,0.9)');
      if (wpx > 26) chip(p[0] - wpx / 2, p[1] - hpx / 2 - 6,
        c.id + ' ' + Math.round(c.v * 3.6) + 'KM/H', '#8ef7ff');
      drawn++;
    }
    drawn = 0;
    for (k = 0; k < peds.length && drawn < 18; k++){
      var pd = peds[k];
      var dist2 = camPos.distanceTo(pd.g.position);
      if (dist2 > 260) continue;
      var p2 = project(pd.g.position.x, pd.g.position.y + 0.9, pd.g.position.z);
      if (!p2) continue;
      var h2 = pxSize(2.0, dist2), w2 = pxSize(1.0, dist2);
      if (h2 < 7) continue;
      bracket(p2[0] - w2 / 2, p2[1] - h2 / 2, w2, h2, 'rgba(157,255,176,0.85)');
      if (h2 > 22) chip(p2[0] - w2 / 2, p2[1] - h2 / 2 - 6, pd.id, '#b8ffc6');
      drawn++;
    }
  }
  // player name tags + chat bubbles (always on) + detection boxes for players
  (function(){
    var nowMs = performance.now();
    function speech(px, py, msg){
      ov.font = '10.5px ui-monospace, Menlo, Consolas, monospace';
      var text = msg.length > 42 ? msg.slice(0, 40) + '…' : msg;
      var w = ov.measureText(text).width;
      ov.fillStyle = 'rgba(240,246,244,0.92)';
      ov.fillRect(px - w / 2 - 5, py - 26, w + 10, 15);
      ov.beginPath();
      ov.moveTo(px - 4, py - 11); ov.lineTo(px + 4, py - 11); ov.lineTo(px, py - 6);
      ov.fill();
      ov.fillStyle = '#10201c';
      ov.fillText(text, px - w / 2, py - 15);
    }
    for (var id in remotes){
      var r = remotes[id];
      var pos = r.m === 2 && r.carG ? r.carG.position : r.av.g.position;
      var dist = camPos.distanceTo(pos);
      if (dist > 600) continue;
      var p = project(pos.x, pos.y + 2.9, pos.z);
      if (!p) continue;
      ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
      var tag = (r.p ? '⌖ ' : '') + r.name;
      var tw = ov.measureText(tag).width;
      chip(p[0] - tw / 2, p[1], tag, r.p ? '#ff9d5a' : '#ffd28a');
      if (r.frozenUntil && r.frozenUntil > nowMs)
        chip(p[0] - 18, p[1] + 13, 'FROZEN', '#9adfff');
      if (r.bubble && r.bubble.until > nowMs) speech(p[0], p[1], r.bubble.msg);
      if (show.box){
        var bp = project(pos.x, pos.y + 1.2, pos.z);
        if (bp){
          var hh = pxSize(2.6, dist), ww = pxSize(1.4, dist);
          if (hh > 7) bracket(bp[0] - ww / 2, bp[1] - hh / 2, ww, hh, 'rgba(255,176,84,0.9)');
        }
      }
    }
    var pp2 = project(player.x, player.y + 2.9, player.z);
    if (pp2){
      if (mode === 'drone'){
        ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
        var tw2 = ov.measureText(myName + ' (YOU)').width;
        chip(pp2[0] - tw2 / 2, pp2[1], myName + ' (YOU)', '#8ef7ff');
      }
      if (myBubble && myBubble.until > nowMs) speech(pp2[0], pp2[1], myBubble.msg);
    }
  })();
  if (show.lbl){
    for (k = 0; k < labels.length; k++){
      var lb = labels[k];
      var d3 = camPos.distanceTo(_v.set(lb.x, lb.y, lb.z));
      if (d3 > 1300) continue;
      var lp = project(lb.x, lb.y, lb.z);
      if (!lp) continue;
      ov.strokeStyle = 'rgba(110,247,223,0.55)'; ov.lineWidth = 1;
      ov.beginPath(); ov.moveTo(lp[0], lp[1]); ov.lineTo(lp[0], lp[1] - 16); ov.stroke();
      ov.fillStyle = '#6ef7df';
      ov.fillRect(lp[0] - 1.5, lp[1] - 1.5, 3, 3);
      chip(lp[0] + 4, lp[1] - 18, lb.name, '#d9fff6');
    }
  }
}

// ---------- main loop ----------
var last = performance.now(), t0 = last, simT = 0;
function fmtClock(h){
  var hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
}
function fmtElapsed(s){
  var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = Math.floor(s) % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + ss).slice(-2);
}
function frame(now){
  requestAnimationFrame(frame);
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused){
    simH = (simH + dt * speed / 3600) % 24;
    simT += dt;
    updateCars(dt, simT);
    updatePeds(dt, simT);
  }
  updatePlayer(dt);
  updateDarts(dt);
  runBots(dt);
  updateRemotes(dt);
  netTick(dt);
  if (mode === 'drone'){
    applyWASD(dt);
    updateRig(dt);
  } else updatePlayerCam(dt);

  // environment
  var env = envAt(simH);
  renderer.setClearColor(skyC);
  scene.fog.color.copy(fogC);
  scene.fog.density = 0.0007 + env.night * 0.00045;
  hemi.color.copy(skyC); hemi.intensity = env.hemi;
  var sa = (simH - 6) / 12 * Math.PI;
  sun.position.set(-Math.cos(sa) * 600, Math.max(30, Math.sin(sa) * 500), 220);
  sun.intensity = env.sun;
  sun.visible = env.sun > 0.04;
  var n = env.night;
  for (var k = 0; k < nightMats.length; k++)
    nightMats[k].m.emissiveIntensity = n * nightMats[k].k;
  lampHeadMat.emissiveIntensity = n * 1.6;
  lampGlowMat.opacity = n * 0.2;
  headMat.emissiveIntensity = 0.15 + n * 2.2;
  tailMat.emissiveIntensity = 0.15 + n * 1.6;

  // signals
  var eg = ewGreen(simT), ng = nsGreen(simT);
  sigEWMat.emissive.setHex(eg ? 0x2aff6a : 0xff3b30);
  sigNSMat.emissive.setHex(ng ? 0x2aff6a : 0xff3b30);
  els.sig.textContent = eg ? 'EW' : ng ? 'NS' : '--';

  els.clock.childNodes[0].nodeValue = fmtClock(simH);
  els.clocksub.textContent = paused ? 'PAUSED · ' + dayName(simH)
    : 'DAY CYCLE ' + speed + '× · ' + dayName(simH);
  els.elapsed.textContent = fmtElapsed((now - t0) / 1000);
  els.fuel.textContent = Math.round(player.fuel);
  var hint = '';
  if (mode === 'player'){
    if (isFrozen()) hint = 'FROZEN — ' + Math.ceil((player.frozenUntil - performance.now()) / 1000) + 's';
    else if (player.veh) hint = 'E — EXIT · W/S DRIVE · A/D STEER · ' + Math.round(Math.abs(player.veh.spd) * 3.6) + ' KM/H';
    else if (player.grounded && nearestVehicle()) hint = 'E — ENTER CAR';
    else if (!player.grounded && player.thrusting) hint = 'JETPACK · FUEL ' + Math.round(player.fuel) + '%';
    else if (player.pvp) hint = 'CLICK/F — FIRE · RMB — AIM · G — HOLSTER';
  }
  els.hint.textContent = hint;
  els.hint.style.display = hint ? 'block' : 'none';

  renderer.render(scene, camera);
  drawOverlay();
}
requestAnimationFrame(frame);
})();

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
// optional deep-link spawn: #x=..&z=..
var spawnX = 14, spawnZ = -9.5;
(function(){
  var mx = /(?:^|[#&])x=(-?[\d.]+)/.exec(hashStr);
  var mz = /(?:^|[#&])z=(-?[\d.]+)/.exec(hashStr);
  if (mx) spawnX = Math.max(X0 - 20, Math.min(X1 + 20, parseFloat(mx[1])));
  if (mz) spawnZ = Math.max(Z0 - 20, Math.min(Z1 + 20, parseFloat(mz[1])));
})();
var player = {x: spawnX, y: 0, z: spawnZ, vy: 0, ry: -Math.PI / 2, phase: 0, swing: 0,
              grounded: true, moving: 0, fuel: 100, thrusting: false, veh: null,
              heli: false, kx: 0, kz: 0,
              pvp: false, frozenUntil: 0,
              av: makeAvatar(myColor, 0x3f7d3f)};
function isFrozen(){ return performance.now() < player.frozenUntil; }

// ---------- nerf darts ----------
var darts = [];
var hitMarkAt = 0, hitMarkName = '', frozenByName = '', wasFrozen = false;
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
  if (ads || camFP){   // spawn on the reticle ray so aimed shots land where the dot is
    ox = camera.position.x + _aim.x * 6;
    oy = camera.position.y + _aim.y * 6;
    oz = camera.position.z + _aim.z * 6;
  } else {
    ox = player.x + _aim.x * 1.1;
    oy = player.y + 1.7 + _aim.y * 1.1;
    oz = player.z + _aim.z * 1.1;
  }
  spawnDart(ox, oy, oz, _aim.x, _aim.y, _aim.z, true);
  sndPew();
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
    var surface = p.y < 0.05 || pointInBuilding(p.x, p.y, p.z);
    if (surface) puff(p.x, Math.max(0.2, p.y), p.z, 0x9adfff, 0.14, 1.1, 240, 0.6, 0.7);
    var dead = now - d.born > 2000 || surface;
    if (!dead && d.mine){
      for (var id in remotes){
        var r = remotes[id];
        if (!r.p) continue;                                   // not opted in
        if (r.m === 3) continue;                              // chopper pilots need RPGs
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
            hitMarkAt = now; hitMarkName = r.name;
            sndHitmark();
          }
          break;
        }
      }
    }
    if (dead){ scene.remove(d.g); darts.splice(i, 1); }
  }
}
// ---------- news chopper (LEXINGTON KY NEWS) ----------
// One shared helicopter. It lives on a helipad cantilevered off Big Blue's
// roof, one pilot at a time (server-arbitrated). Its water cannon shoves
// players around; while it's airborne, RPG crates unlock around downtown —
// three rocket hits bring it down and it respawns on the pad.
var PAD = {x: -127, z: 11, top: 128.35, th: Math.PI / 2};
(function(){
  var padTex = makeTex(128, 128, function(g){
    g.fillStyle = '#3a3d42'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#e8c33a'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e8c33a';
    g.font = 'bold 56px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('H', 64, 66);
  });
  padTex.encoding = THREE.sRGBEncoding;
  padTex.wrapS = padTex.wrapT = THREE.ClampToEdgeWrapping;
  var side = new THREE.MeshStandardMaterial({color: 0x2c2f35, roughness: 0.9});
  var topm = new THREE.MeshStandardMaterial({map: padTex, roughness: 0.9});
  var deck = new THREE.Mesh(new THREE.BoxGeometry(17, 1, 18), [side, side, topm, side, side, side]);
  deck.position.set(PAD.x, PAD.top - 0.5, PAD.z);
  deck.castShadow = true; deck.receiveShadow = true; scene.add(deck);
  colliders.push({x0: PAD.x - 8.5, x1: PAD.x + 8.5, z0: PAD.z - 9, z1: PAD.z + 9, h: PAD.top});
  for (var sx = -1; sx <= 1; sx += 2){   // struts back to the tower face
    var st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), side);
    st.position.set(PAD.x + sx * 6, PAD.top - 3.6, PAD.z + 7.6);
    st.rotation.x = -0.4; scene.add(st);
  }
})();
function heliSideTex(flip){
  var t = makeTex(256, 96, function(g){
    g.fillStyle = '#f4f5f2'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#1d2f5e';                       // navy sweep
    g.beginPath(); g.moveTo(0, 96); g.lineTo(0, 66);
    g.quadraticCurveTo(130, 52, 256, 70); g.lineTo(256, 96);
    g.closePath(); g.fill();
    g.strokeStyle = '#d8b04a'; g.lineWidth = 3;    // gold pinstripe
    g.beginPath(); g.moveTo(0, 66); g.quadraticCurveTo(130, 52, 256, 70); g.stroke();
    drawHorseBadge(g, 10, 12, 34);
    g.fillStyle = '#1d2f5e';
    g.font = 'bold 22px Helvetica, Arial, sans-serif';
    g.fillText('LEXINGTON KY', 54, 32);
    g.fillText('NEWS', 54, 56);
  });
  t.encoding = THREE.sRGBEncoding;
  if (flip){ t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; }
  else t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function buildHeli(){
  var g = new THREE.Group();
  var white = new THREE.MeshStandardMaterial({color: 0xf4f5f2, roughness: 0.45, metalness: 0.15});
  var navy = new THREE.MeshStandardMaterial({color: 0x1d2f5e, roughness: 0.55});
  var dark = new THREE.MeshStandardMaterial({color: 0x2c2f35, roughness: 0.6});
  var brandA = new THREE.MeshStandardMaterial({map: heliSideTex(false), roughness: 0.45});
  var brandB = new THREE.MeshStandardMaterial({map: heliSideTex(true), roughness: 0.45});
  var fus = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.0, 2.1),
    [white, white, white, white, brandA, brandB]);
  fus.castShadow = true; g.add(fus);
  var nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1.9), cabMat);
  nose.position.set(2.55, -0.05, 0); nose.castShadow = true; g.add(nose);
  var cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.3, 8), dark);
  cannon.rotation.z = Math.PI / 2; cannon.position.set(2.6, -0.95, 0); g.add(cannon);
  var boom = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.55, 0.5), white);
  boom.position.set(-3.7, 0.35, 0); boom.castShadow = true; g.add(boom);
  var fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.14), navy);
  fin.position.set(-5.3, 0.95, 0); fin.castShadow = true; g.add(fin);
  for (var sz = -1; sz <= 1; sz += 2){   // skids
    var skid = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 0.2), dark);
    skid.position.set(0.2, -1.38, sz * 0.9); g.add(skid);
    for (var kx = -1; kx <= 1; kx += 2){
      var strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.12), dark);
      strut.position.set(0.2 + kx * 1.1, -1.12, sz * 0.9); g.add(strut);
    }
  }
  var rotor = new THREE.Group(); rotor.position.set(0.2, 1.25, 0);
  var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 6), dark);
  rotor.add(mast);
  for (var b = 0; b < 2; b++){
    var blade = new THREE.Mesh(new THREE.BoxGeometry(10, 0.07, 0.42), dark);
    blade.rotation.y = b * Math.PI / 2; blade.position.y = 0.25; rotor.add(blade);
  }
  g.add(rotor);
  var tRotor = new THREE.Group(); tRotor.position.set(-5.3, 0.95, 0.14);
  for (var tb = 0; tb < 2; tb++){
    var tBlade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.1), dark);
    tBlade.rotation.x = tb * Math.PI / 2; tRotor.add(tBlade);
  }
  g.add(tRotor);
  scene.add(g);
  return {g: g, rotor: rotor, tRotor: tRotor};
}
var heliParts = buildHeli();
var heli = {
  mesh: heliParts.g, rotor: heliParts.rotor, tRotor: heliParts.tRotor,
  x: PAD.x, y: PAD.top + 1.45, z: PAD.z, th: PAD.th,
  vy: 0, spd: 0, hp: 3, pilot: null,          // 'ME' | remote id | null
  rotorSpeed: 0, rotorSpin: 0,
  down: false, boomed: false, downAt: 0, downVy: 0,
  lastPushAt: {}
};
heli.mesh.position.set(heli.x, heli.y, heli.z);
heli.mesh.rotation.y = heli.th;
function heliActive(){ return heli.pilot !== null && !heli.down; }
function heliDist2(x, z){
  var dx = heli.x - x, dz = heli.z - z;
  return dx * dx + dz * dz;
}
function canEnterHeliBase(){
  return mode === 'player' && !player.veh && !player.heli && !isFrozen() &&
    heli.pilot === null && !heli.down && player.grounded &&
    heliDist2(player.x, player.z) < 45 && Math.abs(player.y - (heli.y - 1.45)) < 5;
}
function canEnterHeli(){ return heliUnlocked && canEnterHeliBase(); }
function enterHeliLocal(){
  player.heli = true;
  heli.pilot = 'ME';
  player.av.g.visible = false;
  rigP.r = Math.max(rigP.r, 24);
  addChatLine('* CHOPPER', 'you are flying the LEXINGTON KY NEWS chopper', true);
}
function requestHeli(){
  if (online && ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'heli', a: 'enter'}));
  else enterHeliLocal();
}
function exitHeli(crash){
  player.heli = false;
  if (heli.pilot === 'ME') heli.pilot = null;
  // hop out to the left skid; mid-air bail-outs just fall (jetpack can save you)
  player.x = heli.x - Math.sin(heli.th) * 1.9;
  player.z = heli.z - Math.cos(heli.th) * 1.9;
  player.y = Math.max(groundY(player.x, player.z, heli.y), heli.y - 1.45);
  player.vy = 0; player.grounded = false;
  player.av.g.visible = mode !== 'player' || !camFP;
  collide(player, 0.55, player.y);
  if (online && ws && ws.readyState === 1)
    ws.send(JSON.stringify({t: 'heli', a: 'exit',
      x: +heli.x.toFixed(1), y: +heli.y.toFixed(1), z: +heli.z.toFixed(1),
      th: +Math.atan2(Math.sin(heli.th), Math.cos(heli.th)).toFixed(3),
      crash: crash ? 1 : 0}));
  if (crash) startHeliDown();
}
function startHeliDown(){
  if (heli.down) return;
  heli.down = true; heli.boomed = false;
  heli.downAt = performance.now();
  heli.downVy = Math.min(0, heli.vy);
  if (player.heli){   // ejected — you're falling, hold Space
    player.heli = false;
    player.x = heli.x; player.y = heli.y; player.z = heli.z;
    player.vy = 3; player.grounded = false;
    player.av.g.visible = mode !== 'player' || !camFP;
  }
  heli.pilot = null;
  addChatLine('* CHOPPER', 'NEWS CHOPPER DOWN', false);
}
function handleHeliMsg(m){
  if (m.a === 'snap'){
    heli.pilot = m.pilot === myId ? 'ME' : m.pilot;
    heli.hp = m.hp;
    heli.x = m.x; heli.y = m.y; heli.z = m.z; heli.th = m.th || PAD.th;
  } else if (m.a === 'enter'){
    if (m.id === myId) enterHeliLocal();
    else {
      heli.pilot = m.id;
      addChatLine('* CHOPPER', 'NEWS CHOPPER is up - RPG crates active downtown', false);
    }
  } else if (m.a === 'deny'){
    addChatLine('* CHOPPER', 'someone is already flying it', false);
  } else if (m.a === 'exit'){
    heli.pilot = null;
    heli.x = m.x; heli.y = m.y; heli.z = m.z; heli.th = m.th || heli.th;
    heli.vy = 0; heli.spd = 0;
  } else if (m.a === 'hp'){
    heli.hp = m.hp;
  } else if (m.a === 'down'){
    startHeliDown();
  }
}
// updateHeliFlight: pilot-side arcade flight. W/S fly, A/D turn, Space climb,
// Shift descend; idle input sinks gently so touch players can land by
// releasing. Player state mirrors the heli so net + camera just follow.
function updateHeliFlight(dt){
  var up = keysDown[' '] || stick.jets;
  var dn = keysDown.shift;
  var f = 0, yaw = 0;
  if (!isFrozen()){
    if (keysDown.w || keysDown.arrowup) f += 1;
    if (keysDown.s || keysDown.arrowdown) f -= 1;
    if (keysDown.a || keysDown.arrowleft) yaw += 1;
    if (keysDown.d || keysDown.arrowright) yaw -= 1;
    if (stick.active){ f = -stick.y; yaw = -stick.x; }
  }
  heli.spd += (f ? f * (f > 0 ? 15 : 10) : -heli.spd * 1.2) * dt;
  heli.spd = Math.max(-12, Math.min(36, heli.spd));
  heli.th += yaw * 1.5 * dt;
  var gy = groundY(heli.x, heli.z, heli.y) + 1.45;
  var landed = heli.y <= gy + 0.05;
  var tvy = up ? 17 : dn ? -13 : (landed ? 0 : -1.6);
  heli.vy += (tvy - heli.vy) * Math.min(1, dt * 3);
  var nx = heli.x + Math.cos(heli.th) * heli.spd * dt;
  var nz = heli.z - Math.sin(heli.th) * heli.spd * dt;
  var p = {x: nx, z: nz};
  collide(p, 3.0, heli.y - 1.3);
  if (p.x !== nx || p.z !== nz) heli.spd *= 0.25;   // scraped a building
  heli.x = Math.max(X0 - 20, Math.min(X1 + 20, p.x));
  heli.z = Math.max(Z0 - 20, Math.min(Z1 + 20, p.z));
  heli.y += heli.vy * dt;
  if (heli.y > 178){ heli.y = 178; if (heli.vy > 0) heli.vy = 0; }
  gy = groundY(heli.x, heli.z, heli.y) + 1.45;
  if (heli.y <= gy){
    if (heli.vy < -9){ exitHeli(true); return; }   // hard landing = crash
    heli.y = gy;
    if (heli.vy < 0) heli.vy = 0;
    heli.spd *= Math.max(0, 1 - 3 * dt);
  }
  player.x = heli.x; player.y = heli.y - 1.2; player.z = heli.z;
  player.ry = Math.atan2(Math.cos(heli.th), -Math.sin(heli.th));
  player.moving = Math.abs(heli.spd);
  player.grounded = heli.y <= gy + 0.05;
  player.thrusting = false;
  player.fuel = Math.min(100, player.fuel + 30 * dt);
  heli.mesh.position.set(heli.x, heli.y + Math.sin(performance.now() * 0.004) * 0.05, heli.z);
  heli.mesh.rotation.y = heli.th;
  heli.mesh.rotation.z += (-heli.spd * 0.007 - heli.mesh.rotation.z) * Math.min(1, dt * 4);
  heli.mesh.rotation.x += ((yaw * -0.12) - heli.mesh.rotation.x) * Math.min(1, dt * 4);
  updateSprayPilot(dt);
}
// master heli tick: rotor spool, parked pose, crash animation + respawn
function updateHeli(dt){
  var now = performance.now();
  if (heli.down){
    heli.rotorSpeed = Math.max(0, heli.rotorSpeed - dt * 0.6);
    if (!heli.boomed){
      heli.downVy -= 26 * dt;
      heli.y += heli.downVy * dt;
      heli.th += 2.6 * dt;
      heli.mesh.position.set(heli.x, heli.y, heli.z);
      heli.mesh.rotation.y = heli.th;
      heli.mesh.rotation.z = Math.sin(now * 0.012) * 0.35;
      if (Math.random() < dt * 12)
        puff(heli.x, heli.y + 0.5, heli.z, 0x333333, 0.9, 3.5, 900, 2, 0.55);
      var gyd = groundY(heli.x, heli.z, heli.y) + 1.0;
      if (heli.y <= gyd){
        heli.boomed = true;
        explosion(heli.x, gyd, heli.z, true);
        heli.mesh.visible = false;
      }
    }
    if (now - heli.downAt > 6000){   // respawn on Big Blue
      heli.down = false; heli.boomed = false;
      heli.hp = 3; heli.vy = 0; heli.spd = 0;
      heli.x = PAD.x; heli.y = PAD.top + 1.45; heli.z = PAD.z; heli.th = PAD.th;
      heli.mesh.visible = true;
      heli.mesh.position.set(heli.x, heli.y, heli.z);
      heli.mesh.rotation.set(0, heli.th, 0);
      addChatLine('* CHOPPER', 'news chopper respawned on Big Blue', false);
    }
  } else {
    var occ = heli.pilot !== null;
    heli.rotorSpeed += ((occ ? 1 : 0) - heli.rotorSpeed) * Math.min(1, dt * (occ ? 1.1 : 0.4));
    if (!occ){
      heli.mesh.position.set(heli.x, heli.y, heli.z);
      heli.mesh.rotation.y = heli.th;
      heli.mesh.rotation.z *= Math.max(0, 1 - dt * 2);
      heli.mesh.rotation.x *= Math.max(0, 1 - dt * 2);
    }
  }
  heli.rotorSpin += heli.rotorSpeed * 26 * dt;
  heli.rotor.rotation.y = heli.rotorSpin;
  heli.tRotor.rotation.x = heli.rotorSpin * 3;
}

// ---------- water cannon ----------
var drops = [];
var dropGeo = new THREE.SphereGeometry(0.1, 5, 4);
var dropMat = new THREE.MeshBasicMaterial({color: 0xbfe6ff, transparent: true, opacity: 0.8});
var mouse0Held = false, fireTouchHeld = false;
function sprayHeld(){ return player.heli && (keysDown.f || mouse0Held || fireTouchHeld); }
function spawnDrops(ox, oy, oz, d, n){
  for (var k = 0; k < n && drops.length < 150; k++){
    var m = new THREE.Mesh(dropGeo, dropMat);
    m.position.set(ox, oy, oz);
    var s = 26 + Math.random() * 8;
    drops.push({m: m,
      vx: (d.x + (Math.random() - 0.5) * 0.14) * s,
      vy: (d.y + (Math.random() - 0.5) * 0.14) * s,
      vz: (d.z + (Math.random() - 0.5) * 0.14) * s,
      born: performance.now()});
    scene.add(m);
  }
}
function sprayBurst(ox, oy, oz, dx, dy, dz){
  _aim.set(dx, dy, dz);
  spawnDrops(ox, oy, oz, _aim, 12);
}
function updateDrops(dt){
  var now = performance.now();
  for (var i = drops.length - 1; i >= 0; i--){
    var d = drops[i];
    d.vy -= 22 * dt;
    d.m.position.x += d.vx * dt;
    d.m.position.y += d.vy * dt;
    d.m.position.z += d.vz * dt;
    if (now - d.born > 900 || d.m.position.y < 0.1){
      scene.remove(d.m); drops.splice(i, 1);
    }
  }
}
var lastSprayNet = 0, lastPushCheck = 0;
function updateSprayPilot(dt){
  if (!sprayHeld() || isFrozen()) return;
  camera.getWorldDirection(_aim);
  if (_aim.y > 0.2){ _aim.y = 0.2; _aim.normalize(); }
  var ox = heli.x + Math.cos(heli.th) * 2.9;
  var oy = heli.y - 0.8;
  var oz = heli.z - Math.sin(heli.th) * 2.9;
  spawnDrops(ox, oy, oz, _aim, Math.min(4, Math.ceil(dt * 90)));
  var now = performance.now();
  if (now - lastSprayNet > 200){
    lastSprayNet = now;
    if (online && ws && ws.readyState === 1)
      ws.send(JSON.stringify({t: 'spray',
        ox: +ox.toFixed(1), oy: +oy.toFixed(1), oz: +oz.toFixed(1),
        dx: +_aim.x.toFixed(3), dy: +_aim.y.toFixed(3), dz: +_aim.z.toFixed(3)}));
  }
  if (now - lastPushCheck > 160){
    lastPushCheck = now;
    pushTargets(ox, oy, oz, _aim);
  }
}
// pilot-side hit test: anyone standing in the jet cone gets a shove.
// Online: {t:'push'} to the server (validated, relayed to the target).
// Offline: bots get bounced directly.
function pushTargets(ox, oy, oz, d){
  var now = performance.now();
  var hx = d.x, hz = d.z, hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  function inJet(px, py, pz){
    var rx = px - ox, ry = py - oy, rz = pz - oz;
    var proj = rx * d.x + ry * d.y + rz * d.z;
    if (proj < 2 || proj > 40) return false;
    var qx = rx - d.x * proj, qy = ry - d.y * proj, qz = rz - d.z * proj;
    var rad = 3 + proj * 0.12;
    return qx * qx + qy * qy + qz * qz < rad * rad;
  }
  for (var id in remotes){
    var r = remotes[id];
    if (r.m === 3) continue;
    var pp = r.av.g.position;
    if (!inJet(pp.x, pp.y + 1.2, pp.z)) continue;
    if (now - (heli.lastPushAt[id] || 0) < 320) continue;
    heli.lastPushAt[id] = now;
    if (online && ws && ws.readyState === 1 && id.indexOf('BOT') !== 0){
      ws.send(JSON.stringify({t: 'push', target: id,
        vx: +(hx * 12).toFixed(1), vy: 5.5, vz: +(hz * 12).toFixed(1)}));
    } else {   // offline bots bounce locally
      for (var bk = 0; bk < bots.length; bk++){
        if (bots[bk].id !== id) continue;
        var b = bots[bk];
        b.vy = 6;
        b.s += (b.axis === 'x' ? hx : hz) * 5;
        b.c2 += (b.axis === 'x' ? hz : hx) * 5;
      }
    }
  }
}

// ---------- RPGs (anti-chopper only) ----------
// Crates glow at fixed spots while the chopper is up. Walk over one to grab
// a launcher (2 rockets). Rockets only hurt the helicopter — they burst
// harmlessly on everything else.
var RPG_SPOTS = [[-168, 58], [30, -20], [120, 40], [-115, -20], [-290, 40]];
var rpgSpots = RPG_SPOTS.map(function(p){
  var g = new THREE.Group();
  var crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2),
    new THREE.MeshStandardMaterial({color: 0x4a5232, roughness: 0.85}));
  crate.position.y = 0.45; crate.castShadow = true; g.add(crate);
  var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.8, 8),
    new THREE.MeshStandardMaterial({color: 0x33381f, roughness: 0.7}));
  tube.rotation.z = 0.5; tube.position.y = 1.25; g.add(tube);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 6, 24),
    new THREE.MeshBasicMaterial({color: 0x6ef7df, transparent: true, opacity: 0.7}));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; g.add(ring);
  g.position.set(p[0], groundY(p[0], p[1]), p[1]);
  g.visible = false;
  scene.add(g);
  return {g: g, cool: 0};
});
var myRpg = 0, lastRocket = 0;
function updatePickups(dt){
  var act = heliActive();
  var now = performance.now();
  if (!act && myRpg){ myRpg = 0; }
  for (var k = 0; k < rpgSpots.length; k++){
    var s = rpgSpots[k];
    var vis = act && now > s.cool;
    s.g.visible = vis;
    if (!vis) continue;
    s.g.rotation.y += dt * 1.2;
    if (!player.heli && !player.veh && mode === 'player'){
      var dx = s.g.position.x - player.x, dz = s.g.position.z - player.z;
      if (dx * dx + dz * dz < 6.5 && Math.abs(s.g.position.y - player.y) < 3){
        myRpg = 2;
        s.cool = now + 20000;
        addChatLine('* RPG', 'launcher acquired - F fires at the chopper', true);
      }
    }
  }
}
var rockets = [];
var rocketBodyGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.75, 6);
var rocketBodyMat = new THREE.MeshStandardMaterial({color: 0x5a5f52, roughness: 0.6});
var rocketTipMat = new THREE.MeshStandardMaterial({color: 0x8a2f2a, roughness: 0.5});
function spawnRocket(ox, oy, oz, dx, dy, dz, mine){
  var g = new THREE.Group();
  var body = new THREE.Mesh(rocketBodyGeo, rocketBodyMat);
  body.rotation.x = Math.PI / 2; g.add(body);
  var tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), rocketTipMat);
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.5; g.add(tip);
  g.position.set(ox, oy, oz);
  g.lookAt(ox + dx, oy + dy, oz + dz);
  scene.add(g);
  rockets.push({g: g, vx: dx * 55, vy: dy * 55, vz: dz * 55,
                born: performance.now(), puffAt: 0, mine: !!mine});
  sndRocket();
}
function fireRocket(){
  var now = performance.now();
  if (now - lastRocket < 1100 || isFrozen()) return;
  lastRocket = now;
  if (!missionFight()) myRpg--;   // the ceremonial RPG never runs dry
  camera.getWorldDirection(_aim);
  player.ry = Math.atan2(_aim.x, _aim.z);
  var ox = player.x + _aim.x * 1.5;
  var oy = player.y + 1.9 + _aim.y * 1.5;
  var oz = player.z + _aim.z * 1.5;
  spawnRocket(ox, oy, oz, _aim.x, _aim.y, _aim.z, true);
  if (online && ws && ws.readyState === 1)
    ws.send(JSON.stringify({t: 'rocket',
      ox: +ox.toFixed(1), oy: +oy.toFixed(1), oz: +oz.toFixed(1),
      dx: +_aim.x.toFixed(3), dy: +_aim.y.toFixed(3), dz: +_aim.z.toFixed(3)}));
}
function updateRockets(dt){
  var now = performance.now();
  for (var i = rockets.length - 1; i >= 0; i--){
    var r = rockets[i];
    r.vy -= 3 * dt;
    r.g.position.x += r.vx * dt;
    r.g.position.y += r.vy * dt;
    r.g.position.z += r.vz * dt;
    if (now - r.puffAt > 55){
      r.puffAt = now;
      puff(r.g.position.x, r.g.position.y, r.g.position.z, 0x9a9a92, 0.28, 1.4, 500, 0.6, 0.5);
    }
    var p = r.g.position, boom = false, big = false;
    if (r.mine && missionFight()){
      var mdx = p.x - mh.x, mdy = p.y - mh.y, mdz = p.z - mh.z;
      if (mdx * mdx + mdy * mdy + mdz * mdz < 24){
        boom = true; big = true;
        missionHit();
      }
    }
    if (!boom && heli.pilot !== null && !heli.down){
      var hdx = p.x - heli.x, hdy = p.y - heli.y, hdz = p.z - heli.z;
      if (hdx * hdx + hdy * hdy + hdz * hdz < 22){
        boom = true; big = true;
        if (r.mine){
          if (online && ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'rhit'}));
          else { heli.hp--; if (heli.hp <= 0) startHeliDown(); }
        }
      }
    }
    if (!boom && (now - r.born > 4500 || p.y < 0.1 || pointInBuilding(p.x, p.y, p.z))) boom = true;
    if (boom){
      explosion(p.x, p.y, p.z, big);
      scene.remove(r.g); rockets.splice(i, 1);
    }
  }
}

// ---------- puffs / explosions (pooled-ish transient sprites) ----------
var puffs = [];
var puffGeo = new THREE.SphereGeometry(1, 6, 5);
function puff(x, y, z, col, r0, grow, life, vy, op){
  if (puffs.length > 90) return;
  var m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({
    color: col, transparent: true, opacity: op, depthWrite: false}));
  m.position.set(x, y, z);
  m.scale.setScalar(r0);
  scene.add(m);
  puffs.push({m: m, born: performance.now(), life: life, grow: grow, vy: vy, op: op});
}
function explosion(x, y, z, big){
  puff(x, y, z, 0xffb54a, big ? 2.5 : 1.1, big ? 26 : 11, 380, 0, 0.95);
  puff(x, y, z, 0xff5f3a, big ? 1.6 : 0.7, big ? 18 : 8, 300, 0, 0.9);
  puff(x, y + 1, z, 0x444444, big ? 2 : 0.9, big ? 8 : 4, 900, 3, 0.5);
  sndBoom(big);
}
function updatePuffs(dt){
  var now = performance.now();
  for (var i = puffs.length - 1; i >= 0; i--){
    var p = puffs[i];
    var age = now - p.born;
    if (age > p.life){
      scene.remove(p.m); p.m.material.dispose(); puffs.splice(i, 1);
      continue;
    }
    p.m.scale.addScalar(p.grow * dt);
    p.m.position.y += p.vy * dt;
    p.m.material.opacity = p.op * (1 - age / p.life);
  }
}

// ---------- sound (WebAudio, fully synthesized — no audio assets) ----------
var sndOn = true;
try { sndOn = localStorage.getItem('lt_snd') !== '0'; } catch (e){}
var AC = null, sndMaster = null, rotorGain = null, noiseBuf = null;
function pokeAudio(){
  if (!window.AudioContext && !window.webkitAudioContext) return;
  if (!AC){
    AC = new (window.AudioContext || window.webkitAudioContext)();
    sndMaster = AC.createGain();
    sndMaster.gain.value = sndOn ? 0.5 : 0;
    sndMaster.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // rotor loop: 13 Hz-chopped lowpassed noise + a low triangle hum
    rotorGain = AC.createGain(); rotorGain.gain.value = 0; rotorGain.connect(sndMaster);
    var rn = AC.createBufferSource(); rn.buffer = noiseBuf; rn.loop = true;
    var lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    var chop = AC.createGain(); chop.gain.value = 0.5;
    var lfo = AC.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 13;
    var lfoG = AC.createGain(); lfoG.gain.value = 0.45;
    lfo.connect(lfoG); lfoG.connect(chop.gain);
    rn.connect(lp); lp.connect(chop); chop.connect(rotorGain);
    var hum = AC.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 52;
    var humG = AC.createGain(); humG.gain.value = 0.22;
    hum.connect(humG); humG.connect(rotorGain);
    rn.start(); lfo.start(); hum.start();
  }
  if (AC.state === 'suspended') AC.resume();
}
function setSnd(on){
  sndOn = on;
  if (sndMaster) sndMaster.gain.value = on ? 0.5 : 0;
  try { localStorage.setItem('lt_snd', on ? '1' : '0'); } catch (e){}
  syncBtns();
}
function sndNoise(dur, f0, f1, vol){
  if (!AC || !sndOn) return;
  var src = AC.createBufferSource(); src.buffer = noiseBuf;
  var f = AC.createBiquadFilter(); f.type = 'lowpass';
  var t = AC.currentTime;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  var g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(sndMaster);
  src.start(t); src.stop(t + dur + 0.05);
}
function sndTone(freq, dur, at, type, vol, glideTo){
  if (!AC || !sndOn) return;
  var o = AC.createOscillator(); o.type = type || 'square';
  var t = AC.currentTime + (at || 0);
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  var g = AC.createGain();
  g.gain.setValueAtTime(vol || 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(sndMaster);
  o.start(t); o.stop(t + dur + 0.05);
}
function sndRocket(){ sndNoise(0.55, 2600, 260, 0.4); }
function sndPew(vol){
  sndTone(520, 0.14, 0, 'square', vol || 0.13, 190);
  sndNoise(0.08, 3200, 1500, (vol || 0.13) * 0.6);
}
function sndHitmark(){ sndTone(880, 0.07, 0, 'square', 0.16); sndTone(1320, 0.09, 0.05, 'square', 0.12); }
function sndFrozenMe(){ sndNoise(0.5, 4200, 320, 0.3); sndTone(320, 0.5, 0, 'sine', 0.2, 85); }
function sndThaw(){ sndTone(500, 0.14, 0, 'sine', 0.12, 950); }
function sndBoom(big){
  sndNoise(big ? 1.1 : 0.5, big ? 260 : 420, 55, big ? 0.85 : 0.45);
  sndTone(64, big ? 0.9 : 0.4, 0, 'sine', big ? 0.5 : 0.25, 30);
}
function sndHitClank(){ sndTone(230, 0.16, 0, 'square', 0.2, 120); sndNoise(0.12, 1800, 500, 0.2); }
function sndSnip(){ sndNoise(0.06, 5200, 2600, 0.3); sndNoise(0.07, 4800, 2200, 0.3); }
function sndWin(){
  [523, 659, 784, 1047].forEach(function(f, i){ sndTone(f, 0.28, i * 0.13, 'square', 0.12); });
}
function sndApplause(){
  if (!AC || !sndOn) return;
  for (var i = 0; i < 16; i++) setTimeout(sndNoise.bind(null, 0.09, 2400, 1200, 0.12), i * 90 + Math.random() * 60);
}
function updateRotorSnd(){
  if (!AC || !rotorGain) return;
  var v = 0;
  if (heli.rotorSpeed > 0.15 && !heli.down){
    var d1 = Math.hypot(heli.x - camera.position.x, heli.y - camera.position.y, heli.z - camera.position.z);
    v = Math.max(v, heli.rotorSpeed * Math.max(0, 1 - d1 / 260));
  }
  if (mh && mh.alive){
    var d2 = Math.hypot(mh.x - camera.position.x, mh.y - camera.position.y, mh.z - camera.position.z);
    v = Math.max(v, Math.max(0, 1 - d2 / 260));
  }
  rotorGain.gain.setTargetAtTime(v * 0.55, AC.currentTime, 0.12);
}

// ---------- mission: THE RIBBON CUTTING ----------
// The mayor dedicates "a horse statue" at City Hall; the news chopper keeps
// buzzing the press conference. Shoot it down with the ceremonial RPG.
// Beating it once unlocks the flyable chopper on this device. Fastest
// takedown times go to a shared leaderboard (server-side scores.json).
var MISSION_C = {x: 152, z: 30};              // set-piece center on the plaza
var MISSION_TRIG = {x: 146, z: 14};           // walk here, press E
var heliUnlocked = false, missionBest = 0;
try {
  heliUnlocked = localStorage.getItem('lt_heli_unlock') === '1';
  missionBest = parseInt(localStorage.getItem('lt_mission_best') || '0', 10) || 0;
} catch (e){}
var goldMat = new THREE.MeshStandardMaterial({color: 0xd8b04a, roughness: 0.35, metalness: 0.7});
var stoneMat2 = new THREE.MeshStandardMaterial({color: 0x8a8478, roughness: 0.9});
var drapeMat = new THREE.MeshStandardMaterial({color: 0xcfd2d8, roughness: 1});
var ribbonMat = new THREE.MeshStandardMaterial({color: 0xb01f2e, roughness: 0.6});
var setPieces = {};   // podium, drape, horse, ribbon, posts, trigger ring
(function(){
  var gy = groundY(MISSION_C.x, MISSION_C.z);   // 0.7 (plaza slab)
  // pedestal + draped statue (drape swaps for the gold horse on a win)
  var ped = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 2), stoneMat2);
  ped.position.set(152, gy + 0.6, 36); ped.castShadow = true; scene.add(ped);
  var drape = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 1.6), drapeMat);
  drape.position.set(152, gy + 2.7, 36); drape.castShadow = true; scene.add(drape);
  var horse = new THREE.Group();
  var body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.65), goldMat);
  body.position.y = 1.9; horse.add(body);
  for (var L = 0; L < 4; L++){
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), goldMat);
    leg.position.set(L < 2 ? -0.85 : 0.85, 0.75, L % 2 ? -0.22 : 0.22);
    horse.add(leg);
  }
  var neck = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 0.4), goldMat);
  neck.rotation.z = -0.5; neck.position.set(1.15, 2.6, 0); horse.add(neck);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 0.32), goldMat);
  head.position.set(1.6, 3.1, 0); horse.add(head);
  var tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.18), goldMat);
  tail.rotation.z = 0.6; tail.position.set(-1.25, 2.15, 0); horse.add(tail);
  horse.traverse(function(o){ o.castShadow = true; });
  horse.position.set(152, gy + 1.2, 36);
  horse.visible = false; scene.add(horse);
  colliders.push({x0: 150.4, x1: 153.6, z0: 35, z1: 37, h: gy + 4.4});
  // podium
  var pod = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.8), stoneMat2);
  pod.position.set(152, gy + 0.65, 24); pod.castShadow = true; scene.add(pod);
  var mic = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5),
    new THREE.MeshStandardMaterial({color: 0x2c2f35}));
  mic.rotation.z = 0.4; mic.position.set(151.9, gy + 1.5, 24); scene.add(mic);
  // ribbon between two posts
  var posts = [];
  [148, 156].forEach(function(px){
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), goldMat);
    post.position.set(px, gy + 1.1, 28); post.castShadow = true; scene.add(post);
    posts.push(post);
  });
  var ribbon = new THREE.Mesh(new THREE.BoxGeometry(8, 0.28, 0.05), ribbonMat);
  ribbon.position.set(152, gy + 1.25, 28); scene.add(ribbon);
  var bow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.12), ribbonMat);
  bow.rotation.z = Math.PI / 4; bow.position.set(152, gy + 1.25, 28.05); scene.add(bow);
  // mission trigger: gold ring, always visible
  var trig = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0xd8b04a, transparent: true, opacity: 0.85}));
  trig.rotation.x = Math.PI / 2;
  trig.position.set(MISSION_TRIG.x, gy + 0.2, MISSION_TRIG.z);
  scene.add(trig);
  setPieces = {drape: drape, horse: horse, ribbon: ribbon, bow: bow, trig: trig};
})();
// NPCs (mayor + press) spawn per run
var missionNpcs = [];
function spawnNpc(x, z, col, ry, scale){
  var g = new THREE.Group();
  var body = new THREE.Mesh(pedBodyG, new THREE.MeshStandardMaterial({color: col, roughness: 0.85}));
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  var head = new THREE.Mesh(pedHeadG, skinMat); head.position.y = 1.55; g.add(head);
  g.position.set(x, groundY(x, z) + 0.02, z);
  g.rotation.y = ry;
  g.scale.setScalar(scale || 1);
  scene.add(g);
  missionNpcs.push(g);
  return g;
}
// captions
var capEl = document.getElementById('caption');
var capWhoEl = document.getElementById('capWho');
var capTextEl = document.getElementById('capText');
var capUntil = 0;
function caption(who, text, dur){
  if (!capEl) return;
  capWhoEl.textContent = who + ': ';
  capTextEl.textContent = text;
  capEl.hidden = false;
  capUntil = performance.now() + (dur || 3400);
}
var AMBIENT_CAPS = [
  ['THE MAYOR', 'AS I WAS SAYING--'],
  ['PILOT', 'GREAT SHOT OF THE STATUE, JIM. GETTING LOWER.'],
  ['THE MAYOR', 'THIS IS A SOLEMN HORSE OCCASION.'],
  ['PILOT', 'JIM SAYS ZOOM IN. I AM THE ZOOM, JIM.'],
  ['THE MAYOR', 'SOMEBODY HAND ME THE BIG SCISSORS.'],
  ['SECURITY', 'MA\'AM, THE SCISSORS ARE NOT A WEAPON.'],
  ['PILOT', 'CHANNEL 1 NEWS: WE REPORT. WE HOVER.'],
  ['THE MAYOR', 'I CAN BARELY HEAR MYSELF DEDICATE.']
];
var mission = {stage: 'idle', tStage: 0, t0f: 0, ms: 0, capAt: 0, capIdx: 0};
var mh = null;      // mission chopper {parts, x,y,z,th,hp,alive,down,...}
var chute = null;   // the new guy
function missionFight(){ return mission.stage === 'fight' && mh && mh.alive; }
function nearMissionTrig(){
  var dx = player.x - MISSION_TRIG.x, dz = player.z - MISSION_TRIG.z;
  return dx * dx + dz * dz < 16;
}
function startMission(){
  mission.stage = 'intro'; mission.tStage = 0; mission.capAt = 0; mission.capIdx = 0;
  setPieces.drape.visible = true;
  setPieces.horse.visible = false;
  setPieces.ribbon.visible = true; setPieces.bow.visible = true;
  // mayor behind the podium facing the press; press row facing her
  spawnNpc(152, 25.2, 0x8f2f3c, Math.PI, 0.95);          // the mayor
  spawnNpc(149.5, 18.5, 0x39404a, 0, 0.9);
  spawnNpc(152, 18, 0x2f5d8f, 0, 0.9);
  spawnNpc(154.5, 18.5, 0x6b4a8f, 0, 0.9);
  if (!mh){
    var parts = buildHeli();
    mh = {parts: parts, mesh: parts.g, x: 152, y: 95, z: -80, th: 0, hp: 3,
          alive: false, down: false, boomed: false, downVy: 0, ang: 0, swoopT: 0, spin: 0};
  }
  mh.hp = 3; mh.alive = false; mh.down = false; mh.boomed = false;
  mh.x = 152; mh.y = 95; mh.z = -90; mh.ang = Math.PI / 2; mh.swoopT = 0;
  mh.mesh.visible = true;
  mh.mesh.rotation.set(0, 0, 0);
  caption('ANNOUNCER', 'LIVE FROM CITY HALL: THE DEDICATION OF "A HORSE STATUE"', 3600);
  addChatLine('* MISSION', 'THE RIBBON CUTTING - shoot down the chopper', true);
}
function missionHit(){
  if (!mh || !mh.alive) return;
  mh.hp--;
  sndHitClank();
  if (mh.hp === 2) caption('PILOT', 'WE\'VE BEEN HIT. STAY CALM, JIM.');
  else if (mh.hp === 1) caption('PILOT', 'JIM IS NOT STAYING CALM.');
  if (mh.hp <= 0){
    mh.alive = false; mh.down = true; mh.downVy = 0; mh.spin = 0;
    mission.ms = performance.now() - mission.t0f;
    mission.stage = 'won'; mission.tStage = 0;
    caption('PILOT', 'TELL MY STORY, JIM.', 2600);
    spawnChute(mh.x, mh.y + 1, mh.z);   // the new guy bails with a parachute
  }
}
function spawnChute(x, y, z){
  if (chute) removeChute();
  var av = makeAvatar(0xd97940, 0x39404a);
  av.g.scale.setScalar(0.8);
  av.armL.rotation.x = -2.9; av.armR.rotation.x = -2.9;
  var canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({color: 0xb01f2e, roughness: 0.8, side: THREE.DoubleSide}));
  scene.add(canopy);
  chute = {av: av, canopy: canopy, x: x, y: y, z: z, sway: Math.random() * 6,
           landed: false, doneAt: 0};
}
function removeChute(){
  if (!chute) return;
  scene.remove(chute.av.g); scene.remove(chute.canopy);
  chute = null;
}
function updateChute(dt){
  if (!chute) return;
  var now = performance.now();
  if (!chute.landed){
    chute.sway += dt * 1.6;
    chute.y -= 3.1 * dt;
    chute.x += Math.sin(chute.sway) * 0.8 * dt;
    chute.z += Math.cos(chute.sway * 0.8) * 0.8 * dt;
    var gy = groundY(chute.x, chute.z, chute.y);
    if (chute.y <= gy){
      chute.y = gy; chute.landed = true; chute.doneAt = now + 6000;
      chute.canopy.visible = false;
      chute.av.armL.rotation.x = 0; chute.av.armR.rotation.x = 0;
      caption('THE NEW GUY', 'FIRST DAY. OBVIOUSLY.', 3600);
    }
  } else if (now > chute.doneAt){ removeChute(); return; }
  chute.av.g.position.set(chute.x, chute.y, chute.z);
  chute.canopy.position.set(chute.x, chute.y + 3.4, chute.z);
}
function missionCleanup(){
  mission.stage = 'idle';
  missionNpcs.forEach(function(g){ scene.remove(g); });
  missionNpcs.length = 0;
  if (mh) mh.mesh.visible = false;
  removeChute();
  setPieces.drape.visible = true;
  setPieces.horse.visible = false;
  setPieces.ribbon.visible = true; setPieces.bow.visible = true;
}
function missionFail(why){
  mission.stage = 'fail'; mission.tStage = 0;
  caption('THE MAYOR', why === 'left'
    ? 'THE PRESS CONFERENCE CONTINUES WITHOUT YOU.'
    : 'WE WILL DO THIS INDOORS NEXT YEAR.', 4200);
}
function submitScore(ms){
  try {
    if (!missionBest || ms < missionBest){
      missionBest = ms;
      localStorage.setItem('lt_mission_best', String(Math.round(ms)));
    }
  } catch (e){}
  if (online && ws && ws.readyState === 1)
    ws.send(JSON.stringify({t: 'score', ms: Math.round(ms)}));
}
function fmtMs(ms){ return (ms / 1000).toFixed(1) + 's'; }
function missionPoints(ms){ return Math.max(100, 1000 - Math.round(ms / 100)); }
function showScores(myMs, board){
  var sEl = document.getElementById('scores');
  if (!sEl) return;
  sEl.hidden = false;
  var you;
  if (myMs){
    you = (board === 2 ? 'PLOWED IN ' : 'CHOPPER DOWN IN ') + fmtMs(myMs) +
      ' · +' + missionPoints(myMs) + ' PTS';
    var best = board === 2 ? m2Best : missionBest;
    if (best) you += ' · DEVICE BEST ' + fmtMs(best);
  } else {
    you = (missionBest ? 'RIBBON CUTTING BEST: ' + fmtMs(missionBest) : 'RIBBON CUTTING: NOT YET') +
      ' · ' + (m2Best ? 'SNOW EMERGENCY BEST: ' + fmtMs(m2Best) : 'SNOW EMERGENCY: NOT YET');
  }
  document.getElementById('scoreYou').textContent = you;
  [1, 2].forEach(function(b){
    var list = document.getElementById(b === 2 ? 'scoreList2' : 'scoreList');
    list.textContent = '';
    var li = document.createElement('li');
    li.textContent = online ? 'fetching global times...' : 'OFFLINE — global board unavailable';
    list.appendChild(li);
  });
  if (online && ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'scores'}));
}
function renderScores(m){
  var sEl = document.getElementById('scores');
  if (!sEl || sEl.hidden) return;
  function fill(id, top){
    var list = document.getElementById(id);
    list.textContent = '';
    if (!top || !top.length){
      var li0 = document.createElement('li');
      li0.textContent = 'no times yet — be the first';
      list.appendChild(li0);
      return;
    }
    top.forEach(function(s){
      var li = document.createElement('li');
      li.textContent = (s.n || '?') + ' — ' + fmtMs(s.ms);
      list.appendChild(li);
    });
  }
  fill('scoreList', m.m1 || m.top || []);
  fill('scoreList2', m.m2 || []);
}
function updateMission(dt){
  var now = performance.now();
  if (capEl && !capEl.hidden && now > capUntil) capEl.hidden = true;
  if (setPieces.trig){
    setPieces.trig.rotation.z += dt * 0.8;
    setPieces.trig.visible = mission.stage === 'idle' && mission2.stage === 'idle';
  }
  updateChute(dt);
  if (mh && mh.mesh.visible){
    mh.parts.rotor.rotation.y += 26 * dt;
    mh.parts.tRotor.rotation.x += 78 * dt;
  }
  // the downed chopper keeps falling whatever stage we're in
  if (mh && mh.down && !mh.boomed){
    mh.downVy -= 24 * dt;
    mh.y += mh.downVy * dt;
    mh.th += 2.4 * dt;
    mh.mesh.position.set(mh.x, mh.y, mh.z);
    mh.mesh.rotation.y = mh.th;
    mh.mesh.rotation.z = Math.sin(now * 0.011) * 0.35;
    if (Math.random() < dt * 12) puff(mh.x, mh.y + 0.5, mh.z, 0x333333, 0.9, 3.5, 900, 2, 0.55);
    var gyd = groundY(mh.x, mh.z, mh.y) + 1.0;
    if (mh.y <= gyd){
      mh.boomed = true;
      explosion(mh.x, gyd, mh.z, true);
      mh.mesh.visible = false;
    }
  }
  if (mission.stage === 'idle') return;
  mission.tStage += dt;
  var t = mission.tStage;
  // walking away aborts (intro/fight only)
  if ((mission.stage === 'intro' || mission.stage === 'fight')){
    var pdx = player.x - MISSION_C.x, pdz = player.z - MISSION_C.z;
    if (pdx * pdx + pdz * pdz > 170 * 170){ missionFail('left'); }
  }
  if (mission.stage === 'intro'){
    // chopper flies in from the north while the mayor talks
    mh.z += (30 - mh.z) * Math.min(1, dt * 0.35);
    mh.y += (46 - mh.y) * Math.min(1, dt * 0.4);
    mh.th = -Math.PI / 2;   // nose south, toward City Hall
    mh.mesh.position.set(mh.x, mh.y, mh.z);
    mh.mesh.rotation.y = mh.th;
    if (t > 2.8 && mission.capIdx === 0){ mission.capIdx = 1; caption('THE MAYOR', 'THANK YOU ALL. TODAY WE HONOR... A HORSE.'); }
    if (t > 5.6 && mission.capIdx === 1){ mission.capIdx = 2; caption('THE MAYOR', 'POSSIBLY SEVERAL HORSES. THE PLAQUE IS AMBIGUOUS.'); }
    if (t > 8.2 && mission.capIdx === 2){ mission.capIdx = 3; caption('ANNOUNCER', 'IS THAT... THE NEWS CHOPPER?'); }
    if (t > 10.5){
      mission.stage = 'fight'; mission.tStage = 0; mission.capAt = 4;
      mission.t0f = now;
      mh.alive = true;
      caption('SECURITY', 'CIVILIAN - TAKE THIS RPG. IT IS CEREMONIAL.', 4200);
    }
    return;
  }
  if (mission.stage === 'fight'){
    if (t > 240){ missionFail('timeout'); return; }
    if (t > mission.capAt){
      mission.capAt = t + 6.5 + Math.random() * 3;
      var c = AMBIENT_CAPS[(Math.random() * AMBIENT_CAPS.length) | 0];
      caption(c[0], c[1]);
    }
    // orbit City Hall; every ~9s swoop low over the podium
    mh.ang += dt * 0.55;
    mh.swoopT += dt;
    var ph = mh.swoopT % 9;
    var swoop = ph < 2.4;
    var tr = swoop ? 13 : 32, ta = swoop ? 15 : 40 + Math.sin(mh.ang * 0.7) * 6;
    mh.r = mh.r === undefined ? 32 : mh.r + (tr - mh.r) * Math.min(1, dt * 1.4);
    mh.x = MISSION_C.x + Math.cos(mh.ang) * mh.r;
    mh.z = MISSION_C.z + Math.sin(mh.ang) * mh.r;
    mh.y += (ta - mh.y) * Math.min(1, dt * 1.2);
    mh.th = Math.atan2(-Math.cos(mh.ang), -Math.sin(mh.ang));   // orbit tangent
    mh.mesh.position.set(mh.x, mh.y + Math.sin(now * 0.004) * 0.1, mh.z);
    mh.mesh.rotation.y = mh.th;
    mh.mesh.rotation.z = -0.14;
    mh.mesh.rotation.x = swoop ? -0.1 : 0;
    return;
  }
  if (mission.stage === 'won'){
    if (t > 2.6 && mission.capIdx !== 9){
      mission.capIdx = 9;
      setPieces.ribbon.visible = false; setPieces.bow.visible = false;
      setPieces.drape.visible = false; setPieces.horse.visible = true;
      sndSnip(); sndApplause(); sndWin();
      for (var cf = 0; cf < 8; cf++)
        puff(152 + (Math.random() - 0.5) * 6, 3 + Math.random() * 3, 30 + (Math.random() - 0.5) * 6,
          [0xff2d95, 0x25f4ee, 0xffd23f][cf % 3], 0.3, 1.2, 1200, 1.5, 0.8);
      caption('THE MAYOR', '...AND THAT IS WHY I LOVE THIS CITY.', 3400);
      if (!heliUnlocked){
        heliUnlocked = true;
        try { localStorage.setItem('lt_heli_unlock', '1'); } catch (e){}
        addChatLine('* CHOPPER', 'NEWS CHOPPER UNLOCKED - press E on Big Blue\'s helipad', true);
      }
      submitScore(mission.ms);
    }
    if (t > 6 && mission.capIdx === 9){
      mission.capIdx = 10;
      caption('ANNOUNCER', 'RIBBON CUT. STATUE HORSED. DEMOCRACY SAVED.', 4200);
      showScores(mission.ms);
      mission.stage = 'post'; mission.tStage = 0;
    }
    return;
  }
  if (mission.stage === 'fail'){
    // chopper loses interest and leaves
    if (mh){
      mh.y += 9 * dt; mh.z -= 18 * dt; mh.alive = false;
      mh.mesh.position.set(mh.x, mh.y, mh.z);
    }
    if (t > 5) missionCleanup();
    return;
  }
  if (mission.stage === 'post'){
    if (t > 24) missionCleanup();
  }
}

// ---------- mission 2: SNOW EMERGENCY ----------
// Beating THE RIBBON CUTTING unlocks the City Hall door. The mayor sends you
// out in a snow plow: blade down clears the glowing streets, blade down on
// bare pavement grinds them up (time penalty), and whatever you do, don't
// plow her street — half of reddit is camped out there watching for plows.
var DOOR_P = {x: 161.6, z: 30.5};   // City Hall west entrance
var SNOW_ZONES = [
  {name: 'MAIN ST',   axis: 'x', c: 0,    lo: -80, hi: 20},
  {name: 'VINE ST',   axis: 'x', c: 100,  lo: -80, hi: 20},
  {name: 'SHORT ST',  axis: 'x', c: -100, lo: -40, hi: 60},
  {name: 'UPPER ST',  axis: 'z', c: 0,    lo: -60, hi: 40},
  {name: 'LIMESTONE', axis: 'z', c: 100,  lo: -40, hi: 60}
];
var REDDIT_ZONE = {name: 'MAYORS ST', axis: 'x', c: -200, lo: -60, hi: 40};  // Second St
var _snowSkyC = new THREE.Color(0xb9c2cc);
var m2Best = 0;
try { m2Best = parseInt(localStorage.getItem('lt_m2_best') || '0', 10) || 0; } catch (e){}
// door + marker (built once; ring only shows when unlocked + idle)
var door = {open: false, ang: 0, L: null, R: null, ring: null};
(function(){
  var navy = new THREE.MeshStandardMaterial({color: 0x1d2f5e, roughness: 0.6});
  var glassD = new THREE.MeshStandardMaterial({color: 0x24303c, roughness: 0.3, metalness: 0.4});
  var frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.6, 5.4), navy);
  frame.position.set(162.8, 0.7 + 2.3, DOOR_P.z); scene.add(frame);
  var lintel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 5.8), corniceMat);
  lintel.position.set(162.7, 0.7 + 4.6, DOOR_P.z); scene.add(lintel);
  function panel(sz){
    var pivot = new THREE.Group();
    pivot.position.set(162.5, 0.7, DOOR_P.z + sz * 2.2);
    var p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.9, 2.1), glassD);
    p.position.set(0, 1.95, -sz * 1.05);
    pivot.add(p); scene.add(pivot);
    return pivot;
  }
  door.L = panel(-1); door.R = panel(1);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0xd8b04a, transparent: true, opacity: 0.85}));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(DOOR_P.x - 2.2, 0.9, DOOR_P.z);
  scene.add(ring);
  door.ring = ring;
})();
function nearDoor(){
  var dx = player.x - DOOR_P.x, dz = player.z - DOOR_P.z;
  return dx * dx + dz * dz < 22;
}
var mission2 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, penalty: 0,
                capAt: 0, capIdx: 0, redditHit: false, grindT: 0, scoldAt: 0};
var snowCells = [];        // {m, zone, cleared}
var zoneState = [];        // per SNOW_ZONES: {total, cleared, done}
var redditCells = [];
var plowVeh = null, bladeDown = false, m2Npcs = [];
var snowPts = null, snowGeo = null, m2Sky = 0;
var mayorAv2 = null;
var snowTex = makeTex(64, 64, function(g){
  g.fillStyle = '#eef2f5'; g.fillRect(0, 0, 64, 64);
  for (var i = 0; i < 130; i++){
    g.fillStyle = 'rgba(255,255,255,' + (0.3 + Math.random() * 0.7) + ')';
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  for (i = 0; i < 30; i++){
    g.fillStyle = 'rgba(180,195,210,0.35)';
    g.fillRect(Math.random() * 64, Math.random() * 64, 3, 2);
  }
});
snowTex.encoding = THREE.sRGBEncoding;
var snowMat = new THREE.MeshStandardMaterial({map: snowTex, roughness: 1});
var snowCellGeoX = new THREE.PlaneGeometry(4.8, 11);   // along x
var snowCellGeoZ = new THREE.PlaneGeometry(11, 4.8);   // along z
function buildSnow(){
  clearSnow();
  zoneState = SNOW_ZONES.map(function(){ return {total: 0, cleared: 0, done: false}; });
  function lay(zone, zi, into){
    for (var s = zone.lo; s < zone.hi; s += 5){
      var x = zone.axis === 'x' ? s + 2.5 : zone.c;
      var z = zone.axis === 'x' ? zone.c : s + 2.5;
      var m = new THREE.Mesh(zone.axis === 'x' ? snowCellGeoX : snowCellGeoZ, snowMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.22 + (zi >= 0 ? zi : 5) * 0.008, z);
      m.receiveShadow = true;
      scene.add(m);
      into.push({m: m, x: x, z: z, cleared: false, zi: zi});
      if (zi >= 0) zoneState[zi].total++;
    }
  }
  SNOW_ZONES.forEach(function(zn, zi){ lay(zn, zi, snowCells); });
  lay(REDDIT_ZONE, -1, redditCells);
}
function clearSnow(){
  snowCells.forEach(function(c){ scene.remove(c.m); });
  redditCells.forEach(function(c){ scene.remove(c.m); });
  snowCells.length = 0; redditCells.length = 0;
}
function buildPlow(){
  var g = new THREE.Group();
  var orange = new THREE.MeshStandardMaterial({color: 0xd8821a, roughness: 0.5, metalness: 0.2});
  var steel = new THREE.MeshStandardMaterial({color: 0x6a6f76, roughness: 0.4, metalness: 0.6});
  var dark = new THREE.MeshStandardMaterial({color: 0x2c2f35, roughness: 0.7});
  var bed = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 2.4), orange);
  bed.position.set(-1.1, 1.4, 0); bed.castShadow = true; g.add(bed);
  var cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 2.3), orange);
  cab.position.set(1.4, 1.55, 0); cab.castShadow = true; g.add(cab);
  var glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 2.0), cabMat);
  glass.position.set(2.25, 1.85, 0); g.add(glass);
  var beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5),
    new THREE.MeshStandardMaterial({color: 0xd8821a, emissive: 0xffb020, emissiveIntensity: 0.9}));
  beacon.position.set(1.4, 2.55, 0); g.add(beacon);
  for (var w = 0; w < 6; w++){
    var wh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10), dark);
    wh.rotation.x = Math.PI / 2;
    wh.position.set([-2, 0, 1.7][w % 3], 0.55, w < 3 ? 1.15 : -1.15);
    g.add(wh);
  }
  var blade = new THREE.Group();
  var bl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.5, 3.6), steel);
  bl.rotation.y = 0.28;   // casts snow to the side
  blade.add(bl);
  var arm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.18, 0.18), steel);
  arm.position.set(-0.9, 0.3, 0); blade.add(arm);
  blade.position.set(3.3, 1.6, 0);
  g.add(blade);
  g.position.set(150, 0.15, 0);   // Main St outside City Hall
  g.rotation.y = Math.PI;         // nose west
  scene.add(g);
  var v = {g: g, ai: null, th: Math.PI, spd: 0, plow: true, blade: blade};
  vehicles.push(v);
  return v;
}
function removePlow(){
  if (!plowVeh) return;
  if (player.veh === plowVeh){ player.veh = null; player.av.g.visible = true; }
  var i = vehicles.indexOf(plowVeh);
  if (i >= 0) vehicles.splice(i, 1);
  scene.remove(plowVeh.g);
  plowVeh = null;
}
function toggleBlade(){
  if (!player.veh || !player.veh.plow) return;
  bladeDown = !bladeDown;
  sndTone(bladeDown ? 180 : 320, 0.18, 0, 'square', 0.15, bladeDown ? 90 : 500);
}
var M2_AMBIENT = [
  ['DISPATCH', 'BLADE DOWN ON SNOW. BLADE UP ON... NOT SNOW.'],
  ['RADIO', 'CALLER SAYS A PLOW IS DOING GREAT WORK DOWNTOWN. SUSPICIOUS.'],
  ['DISPATCH', 'REMEMBER: THE BLADE HAS TWO POSITIONS. YOU WANT THE CORRECT ONE.'],
  ['RADIO', 'R/LEXINGTON IS POSTING PLOW SIGHTINGS AGAIN.'],
  ['DISPATCH', 'FIVE STREETS. ONE TRUCK. NO PRESSURE.']
];
var M2_SCOLDS = [
  ['DISPATCH', 'THAT SOUND IS THE ROAD. STOP THAT.'],
  ['THE MAYOR', 'I CAN HEAR THE PAVEMENT FROM MY OFFICE.'],
  ['DISPATCH', 'BLADE UP. BLADE UP. BLADE UP.']
];
function startMission2(){
  mission2.stage = 'brief'; mission2.tStage = 0; mission2.capIdx = 0;
  mission2.t0 = 0; mission2.penalty = 0; mission2.redditHit = false;
  mission2.grindT = 0; mission2.scoldAt = 0; mission2.capAt = 0;
  door.open = true;
  sndTone(90, 0.7, 0, 'triangle', 0.2, 55);   // door creak
  mayorAv2 = spawnNpc(161.3, DOOR_P.z, 0x8f2f3c, -Math.PI / 2, 0.95);
  m2Npcs.push(mayorAv2);
  caption('THE MAYOR', 'OH GOOD. THE CHOPPER PERSON.', 3200);
}
function m2Cleanup(){
  mission2.stage = 'idle';
  door.open = false;
  clearSnow();
  removePlow();
  bladeDown = false;
  m2Npcs.forEach(function(g){ scene.remove(g); });
  m2Npcs.length = 0;
  mayorAv2 = null;
  if (snowPts) snowPts.visible = false;
}
function m2Fail(){
  mission2.stage = 'fail'; mission2.tStage = 0;
  caption('THE MAYOR', 'FORGET IT. IT WILL MELT EVENTUALLY.', 4200);
}
function spawnRedditCrowd(){
  for (var k = 0; k < 8; k++){
    var x = REDDIT_ZONE.lo + 8 + Math.random() * (REDDIT_ZONE.hi - REDDIT_ZONE.lo - 16);
    var z = REDDIT_ZONE.c + (k % 2 ? 11 : -11);
    var g = spawnNpc(x, z, [0x39404a, 0x2f5d8f, 0x6b4a8f, 0xc9a44a][k % 4],
      k % 2 ? Math.PI : 0, 0.9);
    m2Npcs.push(g);
  }
}
function ensureSnowPts(){
  if (snowPts) { snowPts.visible = true; return; }
  var N = 1300;
  snowGeo = new THREE.BufferGeometry();
  var pos = new Float32Array(N * 3);
  for (var i = 0; i < N; i++){
    pos[i * 3] = (Math.random() - 0.5) * 260;
    pos[i * 3 + 1] = Math.random() * 90;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 260;
  }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.55, transparent: true, opacity: 0.85, sizeAttenuation: true}));
  scene.add(snowPts);
}
function updateSnowPts(dt){
  if (!snowPts || !snowPts.visible) return;
  var pos = snowGeo.attributes.position.array;
  var t = performance.now() * 0.001;
  for (var i = 0; i < pos.length; i += 3){
    pos[i + 1] -= (6.5 + (i % 7)) * dt * 0.7;
    pos[i] += Math.sin(t + i) * dt * 1.2;
    if (pos[i + 1] < 0) pos[i + 1] = 90;
  }
  snowGeo.attributes.position.needsUpdate = true;
  snowPts.position.set(camera.position.x, 0, camera.position.z);
}
function m2ZonesDone(){
  for (var z = 0; z < zoneState.length; z++)
    if (zoneState[z].cleared < zoneState[z].total - 2) return false;
  return true;
}
// blade vs snow/pavement, run while driving the plow
function updatePlowing(dt){
  var v = plowVeh;
  var g = v.g.position;
  v.blade.position.y += ((bladeDown ? 0.62 : 1.6) - v.blade.position.y) * Math.min(1, dt * 6);
  if (!bladeDown || Math.abs(v.spd) < 1.5) return;
  var bx = g.x + Math.cos(v.th) * 3.4;
  var bz = g.z - Math.sin(v.th) * 3.4;
  var hitSnow = false;
  function sweep(cells, isReddit){
    for (var k = 0; k < cells.length; k++){
      var c = cells[k];
      if (c.cleared) continue;
      var dx = bx - c.x, dz = bz - c.z;
      if (dx * dx + dz * dz > 20) continue;
      c.cleared = true;
      c.m.visible = false;
      hitSnow = true;
      for (var p = 0; p < 3; p++)
        puff(c.x + (Math.random() - 0.5) * 4, 1 + Math.random(), c.z + (Math.random() - 0.5) * 4,
          0xffffff, 0.5, 3, 500, 2.5, 0.8);
      sndNoise(0.25, 900, 300, 0.18);
      if (isReddit){
        mission2.penalty += 1;
        for (var f = 0; f < 5; f++)   // camera flashes from the crowd
          puff(c.x + (Math.random() - 0.5) * 14, 2.2, REDDIT_ZONE.c + (Math.random() < 0.5 ? 11 : -11),
            0xffffff, 0.4, 6, 220, 0, 0.9);
        if (!mission2.redditHit){
          mission2.redditHit = true;
          caption('RADIO', 'BREAKING: PLOW SPOTTED ON THE MAYOR\'S STREET. 4,000 UPVOTES AND CLIMBING.', 4200);
          setTimeout(function(){ if (mission2.stage === 'plow') caption('THE MAYOR', 'I TOLD YOU. IT\'S ALREADY ON REDDIT.', 3800); }, 4400);
        }
      } else {
        var zs = zoneState[c.zi];
        zs.cleared++;
        if (!zs.done && zs.cleared >= zs.total - 2){
          zs.done = true;
          sndTone(880, 0.25, 0, 'square', 0.14);
          caption('DISPATCH', SNOW_ZONES[c.zi].name + ': PLOWED. GORGEOUS.', 3000);
        }
      }
    }
  }
  sweep(snowCells, false);
  sweep(redditCells, true);
  if (!hitSnow){
    // grinding bare pavement: sparks + penalty
    mission2.grindT += dt;
    if (mission2.grindT > 0.6){
      mission2.grindT = 0;
      mission2.penalty += 1;
      sndNoise(0.3, 2600, 900, 0.22);
      if (mission2.tStage > mission2.scoldAt){
        mission2.scoldAt = mission2.tStage + 7;
        var sc = M2_SCOLDS[(Math.random() * M2_SCOLDS.length) | 0];
        caption(sc[0], sc[1]);
      }
    }
    puff(bx, 0.5, bz, 0xffb020, 0.16, 1.6, 260, 1.5, 0.85);
  } else mission2.grindT = 0;
}
function updateMission2(dt){
  var now = performance.now();
  door.ang += (((door.open ? 1.55 : 0)) - door.ang) * Math.min(1, dt * 2.5);
  door.L.rotation.y = -door.ang;
  door.R.rotation.y = door.ang;
  door.ring.visible = heliUnlocked && mission2.stage === 'idle' && mission.stage === 'idle';
  if (door.ring.visible) door.ring.rotation.z += dt * 0.8;
  updateSnowPts(dt);
  // overcast blend handled in frame() via m2Sky
  var storm = mission2.stage === 'plow' || mission2.stage === 'brief';
  m2Sky += ((storm ? 1 : 0) - m2Sky) * Math.min(1, dt * (storm ? 0.5 : 0.35));
  if (mission2.stage === 'idle') return;
  mission2.tStage += dt;
  var t = mission2.tStage;
  if (mission2.stage === 'brief'){
    if (t > 3 && mission2.capIdx === 0){ mission2.capIdx = 1; caption('THE MAYOR', 'FREAK SNOWSTORM INBOUND. THE STREETS NEED PLOWING AND MY PLOW GUY IS AT THE LAKE.', 4400); }
    if (t > 7.6 && mission2.capIdx === 1){ mission2.capIdx = 2; caption('THE MAYOR', 'TAKE THE TRUCK ON MAIN. BLADE DOWN ON SNOW ONLY - YOU GRIND MY ROADS, I HEAR IT.', 4600); }
    if (t > 12.4 && mission2.capIdx === 2){ mission2.capIdx = 3; caption('THE MAYOR', 'WHATEVER YOU DO, DON\'T PLOW MY STREET. I GOT HALF OF REDDIT CAMPED OUT THERE WATCHING FOR THE PLOWS NOW.', 5200); }
    if (t > 18){
      mission2.stage = 'plow'; mission2.tStage = 0; mission2.capAt = 20;
      ensureSnowPts();
      buildSnow();
      spawnRedditCrowd();
      plowVeh = buildPlow();
      bladeDown = false;
      caption('DISPATCH', 'PLOW IS ON MAIN ST BY CITY HALL. CLOCK STARTS WHEN YOU CLIMB IN.', 4600);
      addChatLine('* MISSION', 'SNOW EMERGENCY - plow the glowing streets', true);
    }
    return;
  }
  if (mission2.stage === 'plow'){
    if (!mission2.t0){
      if (player.veh === plowVeh){
        mission2.t0 = now;
        caption('DISPATCH', 'CLOCK STARTED. SPACE WORKS THE BLADE.', 3600);
      } else if (t > 300){ m2Cleanup(); }   // nobody took the truck
      return;
    }
    if (player.veh === plowVeh) updatePlowing(dt);
    else if (plowVeh) plowVeh.blade.position.y += ((bladeDown ? 0.62 : 1.6) - plowVeh.blade.position.y) * Math.min(1, dt * 6);
    if (t > mission2.capAt){
      mission2.capAt = t + 11 + Math.random() * 5;
      var c = M2_AMBIENT[(Math.random() * M2_AMBIENT.length) | 0];
      caption(c[0], c[1]);
    }
    if ((now - mission2.t0) / 1000 > 420){ m2Fail(); return; }
    if (m2ZonesDone()){
      mission2.ms = (now - mission2.t0) + mission2.penalty * 1000;
      mission2.stage = 'won'; mission2.tStage = 0;
      sndWin(); sndApplause();
      caption('THE MAYOR', mission2.redditHit
        ? 'YOU HAD ONE RULE. ONE. ...BUT FINE, THE STREETS LOOK GREAT.'
        : 'STREETS CLEAR. MY STREET REMAINS A LEGEND. PERFECT.', 4600);
      try {
        if (!m2Best || mission2.ms < m2Best){
          m2Best = mission2.ms;
          localStorage.setItem('lt_m2_best', String(Math.round(mission2.ms)));
        }
      } catch (e){}
      if (online && ws && ws.readyState === 1)
        ws.send(JSON.stringify({t: 'score', ms: Math.round(mission2.ms), m: 2}));
    }
    return;
  }
  if (mission2.stage === 'won'){
    if (t > 4.6 && mission2.capIdx !== 9){
      mission2.capIdx = 9;
      caption('DISPATCH', 'DOWNTOWN: PLOWED. GO WARM UP.', 4000);
      showScores(mission2.ms, 2);
      mission2.stage = 'post'; mission2.tStage = 0;
    }
    return;
  }
  if (mission2.stage === 'fail'){
    if (t > 5) m2Cleanup();
    return;
  }
  if (mission2.stage === 'post'){
    if (t > 22) m2Cleanup();
  }
}

// dev hook, only with #debug=1: poke the mission from the console
if (/debug=1/.test(hashStr)){
  window.__lt = {
    hit: function(){ missionHit(); },
    stage: function(){ return mission.stage; },
    unlock: function(){ return heliUnlocked; },
    m2stage: function(){ return mission2.stage; },
    tp: function(x, z){ player.x = x; player.z = z; player.y = groundY(x, z); },
    audio: function(){ pokeAudio(); return AC ? AC.state : 'none'; },
    pos: function(){ return {x: player.x, y: player.y, z: player.z}; },
    cam: function(){ return {az: rigP.az, el: rigP.el}; },
    setCam: function(az, el){ rigP.az = az; if (el !== undefined) rigP.el = el; followPause = 3; },
    audioTap: function(){   // MediaStream of the game's synth audio (for capture rigs)
      pokeAudio();
      if (!AC) return null;
      var d = AC.createMediaStreamDestination();
      sndMaster.connect(d);
      return d.stream;
    },
    aimHeli: function(){    // point the FP camera at the mission chopper, with lead
      if (!mh) return false;
      var ex = player.x, ey = player.y + 2.35, ez = player.z;
      var L0 = Math.hypot(mh.x - ex, mh.y - ey, mh.z - ez);
      var t = L0 / 55;      // rocket flight time
      var ang2 = mh.ang + 0.55 * t;
      var r = mh.r === undefined ? 32 : mh.r;
      var px = MISSION_C.x + Math.cos(ang2) * r;
      var pz = MISSION_C.z + Math.sin(ang2) * r;
      var dx = px - ex, dy = mh.y - ey, dz = pz - ez;
      var L = Math.hypot(dx, dy, dz);
      rigP.el = -Math.asin(dy / L);
      rigP.az = Math.atan2(-dx, -dz);
      return true;
    },
    m2: function(){ return {t0: mission2.t0, penalty: mission2.penalty,
      zones: zoneState.map(function(z){ return z.cleared + '/' + z.total; })}; },
    plowZone: function(zi){   // clear one zone's snow instantly
      snowCells.forEach(function(c){
        if (c.zi !== zi || c.cleared) return;
        c.cleared = true; c.m.visible = false; zoneState[zi].cleared++;
      });
      zoneState[zi].done = zoneState[zi].cleared >= zoneState[zi].total - 2;
    },
    plowReddit: function(){
      var c = redditCells.filter(function(x){ return !x.cleared; })[0];
      if (c){ c.cleared = true; c.m.visible = false; mission2.penalty += 1;
        if (!mission2.redditHit){ mission2.redditHit = true;
          caption('RADIO', 'BREAKING: PLOW SPOTTED ON THE MAYOR\'S STREET. 4,000 UPVOTES AND CLIMBING.', 4200); } }
    }
  };
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
function fireAction(){
  if (player.heli) return;   // water cannon is hold-to-spray, handled in flight
  if (missionFight() && !player.veh){ fireRocket(); return; }
  if (myRpg > 0 && heliActive() && !player.veh){ fireRocket(); return; }
  fireDart();
}
function tryEnterExit(){
  if (mode !== 'player') return;
  if (player.heli){
    // bailing out above the ground crashes the chopper (it respawns on Big Blue)
    var hgy = groundY(heli.x, heli.z, heli.y) + 1.45;
    exitHeli(heli.y > hgy + 3);
    return;
  }
  if (mission.stage === 'idle' && mission2.stage === 'idle' && !player.veh && !isFrozen() && nearMissionTrig()){
    startMission();
    return;
  }
  if (heliUnlocked && mission2.stage === 'idle' && mission.stage === 'idle' &&
      !player.veh && !isFrozen() && nearDoor()){
    startMission2();
    return;
  }
  if (canEnterHeli()){ requestHeli(); return; }
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
  var frozenNow = isFrozen();
  if (wasFrozen && !frozenNow){ sndThaw(); frozenByName = ''; }
  wasFrozen = frozenNow;
  player.av.ice.visible = frozenNow;
  if (player.heli && mode === 'player'){ updateHeliFlight(dt); return; }
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
  // water-cannon knockback: an impulse that decays; while it's strong you
  // can't fight it at full walking speed (also keeps combined speed under
  // the server's per-mode cap so pushes don't rubber-band)
  var kmag = Math.hypot(player.kx || 0, player.kz || 0);
  if (kmag > 0.05){
    player.x += player.kx * dt; player.z += player.kz * dt;
    var kdec = Math.max(0, 1 - 2.2 * dt);
    player.kx *= kdec; player.kz *= kdec;
    sp *= Math.max(0.25, 1 - kmag / 10);
  } else { player.kx = 0; player.kz = 0; }
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
  if (player.vy < -30) player.vy = -30;   // terminal velocity
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
// RPG in hand: lock into first person so the chopper is actually aimable
// (third-person elevation can't look up past ~8 degrees)
function rpgOut(){
  return mode === 'player' && !player.veh && !player.heli &&
    (missionFight() || (myRpg > 0 && heliActive()));
}
// first-person RPG viewmodel, parented to the camera (past the near plane)
scene.add(camera);
var rpgView = new THREE.Group();
(function(){
  var olive = new THREE.MeshStandardMaterial({color: 0x4a5232, roughness: 0.8});
  var darkTip = new THREE.MeshStandardMaterial({color: 0x33381f, roughness: 0.7});
  var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.25, 8), olive);
  tube.rotation.x = Math.PI / 2;
  rpgView.add(tube);
  var muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.22, 8), darkTip);
  muzzle.rotation.x = Math.PI / 2; muzzle.position.z = -0.7; rpgView.add(muzzle);
  var sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.03), darkTip);
  sight.position.set(0, 0.1, -0.25); rpgView.add(sight);
  rpgView.position.set(0.5, -0.42, -1.55);
  rpgView.rotation.set(-0.05, 0.08, 0.06);
  rpgView.visible = false;
  camera.add(rpgView);
})();
var camR = 13, aimBlend = 0, camFP = false;
function updatePlayerCam(dt){
  followPause -= dt;
  var aiming = ads && !player.veh && (player.pvp || player.heli || missionFight() || (myRpg > 0 && heliActive()));
  aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * 9);
  var tf = aiming ? 42 : 55;
  if (Math.abs(camera.fov - tf) > 0.05){
    camera.fov += (tf - camera.fov) * Math.min(1, dt * 9);
    camera.updateProjectionMatrix();
  }
  var fp = camFP || rpgOut();
  player.av.g.visible = !fp && !player.veh && !player.heli;
  // first person can look almost straight up (that's where the chopper is)
  rigP.el = Math.max(fp ? -1.45 : -0.15, Math.min(fp ? 1.45 : 1.35, rigP.el));
  rpgView.visible = fp && rpgOut();
  if (fp){
    // first person: eye / hood / cockpit; same az-el mapping as third person
    var ex, ey, ez;
    if (player.heli){
      ex = heli.x + Math.cos(heli.th) * 1.7; ey = heli.y + 0.45;
      ez = heli.z - Math.sin(heli.th) * 1.7;
    } else if (player.veh){
      var vg = player.veh.g.position;
      ex = vg.x + Math.cos(player.veh.th) * 0.4; ey = vg.y + 1.95;
      ez = vg.z - Math.sin(player.veh.th) * 0.4;
    } else {
      ex = player.x; ey = player.y + 2.35; ez = player.z;
    }
    camera.position.set(ex, ey, ez);
    camera.lookAt(
      ex - Math.cos(rigP.el) * Math.sin(rigP.az),
      ey - Math.sin(rigP.el),
      ez - Math.cos(rigP.el) * Math.cos(rigP.az));
    return;
  }
  // soft follow: settle behind the character/vehicle when the mouse is idle
  if (followPause <= 0){
    var tAz = null;
    if (player.heli)
      tAz = Math.atan2(Math.cos(heli.th), -Math.sin(heli.th)) + Math.PI;
    else if (player.veh)
      tAz = Math.atan2(Math.cos(player.veh.th), -Math.sin(player.veh.th)) + Math.PI;
    else if (player.moving > 0)
      tAz = player.ry + Math.PI;
    if (tAz !== null)
      rigP.az += angDelta(rigP.az, tAz) * Math.min(1, dt * (player.veh || player.heli ? 1.7 : 2.1));
  }
  rigP.r = Math.max(4, Math.min(90, rigP.r));
  camR += ((aiming ? (player.heli ? 9 : 4.4) : rigP.r) - camR) * Math.min(1, dt * 9);
  // over-the-shoulder framing: a light constant offset on foot (the avatar
  // rides left-of-center instead of blocking the view), stronger while aiming
  var onFoot = !player.veh && !player.heli;
  var offAmt = 1.25 * aimBlend + (onFoot ? 0.55 * (1 - aimBlend) : 0);
  var offX = Math.cos(rigP.az) * offAmt;
  var offZ = -Math.sin(rigP.az) * offAmt;
  var offY = 0.4 * aimBlend + (onFoot ? 0.12 * (1 - aimBlend) : 0);
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
    if (heli.pilot === id) heli.pilot = null;   // server broadcasts the crash
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
    if (m.heli) handleHeliMsg(m.heli);
    setNetChip();
    var adm = /admin=([^&#]+)/.exec(hashStr);   // #admin=<token> auto-auth
    if (adm) ws.send(JSON.stringify({t: 'chat', msg: '/admin ' + decodeURIComponent(adm[1])}));
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
    if (m.dur !== 0){   // tag feedback for shooter + victim
      if (m.by === myId && m.id !== myId){
        hitMarkAt = performance.now();
        hitMarkName = remotes[m.id] ? remotes[m.id].name : '';
        sndHitmark();
      }
      if (m.id === myId){
        frozenByName = m.by && remotes[m.by] ? remotes[m.by].name : 'SOMEONE';
        sndFrozenMe();
      }
    }
  } else if (m.t === 'shot'){
    if (m.id !== myId){
      spawnDart(m.ox, m.oy, m.oz, m.dx, m.dy, m.dz, false);
      var sd = Math.hypot(m.ox - camera.position.x, m.oz - camera.position.z);
      if (sd < 90) sndPew(0.1 * Math.max(0.2, 1 - sd / 90));
    }
  } else if (m.t === 'heli'){
    handleHeliMsg(m);
  } else if (m.t === 'pushed'){
    if (m.id === myId){   // caught in the water cannon jet
      player.kx += m.vx || 0; player.kz += m.vz || 0;
      if (m.vy){ player.vy = Math.max(player.vy, m.vy); player.grounded = false; }
    }
  } else if (m.t === 'rocket'){
    if (m.id !== myId)
      spawnRocket(m.ox, m.oy, m.oz, m.dx, m.dy, m.dz, false);
  } else if (m.t === 'spray'){
    if (m.id !== myId)
      sprayBurst(m.ox, m.oy, m.oz, m.dx, m.dy, m.dz);
  } else if (m.t === 'scores'){
    renderScores(m);
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
  while (chatLog.children.length > 4) chatLog.removeChild(chatLog.firstChild);
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
    } else if (r.m === 3){ // flying the news chopper: the one heli follows them
      if (r.carG) r.carG.visible = false;
      r.av.g.visible = false;
      r.av.g.position.set(x, y, z);   // tag/dart anchor
      heli.pilot = id;
      heli.x = x; heli.y = y + 1.2; heli.z = z; heli.th = r.ry;
      if (!heli.down){
        heli.mesh.position.set(heli.x, heli.y, heli.z);
        heli.mesh.rotation.y = heli.th;
        heli.mesh.rotation.z += (-Math.min(36, spd) * 0.007 - heli.mesh.rotation.z) * Math.min(1, dt * 4);
      }
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
// WebSocket: #ws=1 -> same origin; #ws=<url> -> explicit. Default: try same
// origin when http(s). Reconnects forever with backoff — server restarts
// (deploys) used to strand open tabs in LOCAL-SIM until a manual refresh.
(function(){
  var wsM = /ws=([^&#]+)/.exec(hashStr);
  var url = null;
  if (wsM) url = wsM[1] === '1'
    ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
    : decodeURIComponent(wsM[1]);
  else if (location.protocol === 'http:' || location.protocol === 'https:')
    url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  if (!url) return;
  var retryMs = 2000;
  function connectWS(){
    try { ws = new WebSocket(url); } catch (e){ ws = null; scheduleReconnect(); return; }
    ws.onopen = function(){ retryMs = 2000; };
    ws.onmessage = function(ev){ try { handleNet(JSON.parse(ev.data)); } catch (e){} };
    ws.onclose = ws.onerror = function(){
      if (online){
        online = false; setNetChip();
        addChatLine('* NET', 'connection lost - reconnecting...', false);
      }
      if (ws){ ws.onclose = ws.onerror = null; ws = null; scheduleReconnect(); }
    };
  }
  var reconnectTimer = null;
  function scheduleReconnect(){
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function(){
      reconnectTimer = null;
      connectWS();
    }, retryMs + Math.random() * 1000);
    retryMs = Math.min(30000, retryMs * 1.7);
  }
  connectWS();
})();
// ---------- diagnostics beacons ----------
// Uncaught errors (max 3/session) and a once-a-minute fps sample go to the
// server's operational log so bugs in the wild are findable.
var errSent = 0;
window.addEventListener('error', function(ev){
  if (errSent >= 3 || !online || !ws || ws.readyState !== 1) return;
  errSent++;
  try {
    ws.send(JSON.stringify({t: 'err',
      msg: String(ev.message || ev.error || 'unknown').slice(0, 180),
      src: String(ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0)}));
  } catch (e){}
});
var diagFrames = 0, diagAcc = 0;
function diagTick(dt){
  diagFrames++;
  diagAcc += dt;
  if (diagAcc < 60) return;
  var fps = Math.round(diagFrames / diagAcc);
  diagFrames = 0; diagAcc = 0;
  if (online && ws && ws.readyState === 1)
    ws.send(JSON.stringify({t: 'diag', fps: fps, coarse: IS_COARSE ? 1 : 0,
      dpr: Math.round((window.devicePixelRatio || 1) * 10) / 10, peers: peerCount()}));
}

var netAcc = 0;
function netTick(dt){
  netAcc += dt;
  if (netAcc < 0.1) return;
  netAcc = 0;
  if (online && ws && ws.readyState === 1){
    // headings accumulate past ±2π with continued turning — normalize before
    // sending or the server's ry bounds check starts rejecting every move
    var sry = player.heli ? heli.th : player.veh ? player.veh.th : player.ry;
    sry = Math.atan2(Math.sin(sry), Math.cos(sry));
    ws.send(JSON.stringify({t: 'state', n: myName, c: myColor,
      m: player.heli ? 3 : player.veh ? 2 : (player.thrusting ? 1 : 0),
      p: player.pvp ? 1 : 0,
      x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2),
      ry: +sry.toFixed(3)}));
  }
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
  if (e.button === 0){ mouse0Held = true; if (!player.heli) fireAction(); }
  if (e.button === 2 && (player.pvp || player.heli || missionFight() || (myRpg > 0 && heliActive()))) ads = true;
});
document.addEventListener('mouseup', function(e){
  if (e.button === 0) mouse0Held = false;
  if (e.button === 2) ads = false;
});
document.addEventListener('contextmenu', function(e){ if (ptrLocked) e.preventDefault(); });
glCanvas.style.touchAction = 'none';
glCanvas.addEventListener('pointerdown', function(e){
  pokeAudio();
  if (ptrLocked) return;
  if (mode === 'player' && e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.4){
    stick.active = true; stick.id = e.pointerId;
    stick.ox = e.clientX; stick.oy = e.clientY; stick.x = 0; stick.y = 0;
    try { glCanvas.setPointerCapture(e.pointerId); } catch (err){}
    return;
  }
  drag = {id: e.pointerId, x: e.clientX, y: e.clientY,
          pan: mode === 'drone' && (e.shiftKey || e.button === 2)};
  try { glCanvas.setPointerCapture(e.pointerId); } catch (err){}
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
  if (mode === 'player'){
    if (camFP){   // scroll out of first person
      if (e.deltaY > 0){ camFP = false; rigP.r = 6; syncBtns(); }
      return;
    }
    rigP.r *= Math.exp(e.deltaY * 0.0011);
    if (rigP.r < 4.05){ camFP = true; syncBtns(); }   // scroll all the way in
    return;
  }
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
  pokeAudio();   // browsers unlock audio on the first real gesture
  if (e.target === chatIn){
    if (e.key === 'Escape'){ chatIn.value = ''; chatIn.blur(); }
    if (e.key === 'Enter') sendChat();
    return;
  }
  if (e.target && e.target.id === 'nameIn'){
    if (e.key === 'Enter' || e.key === 'Escape') tutClose();
    return;
  }
  if (e.key === 'Escape' && els.scores && !els.scores.hidden){ els.scores.hidden = true; return; }
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
  if (k === ' ' && player.veh && player.veh.plow && !e.repeat){ toggleBlade(); }
  if (k === ' ' || k.indexOf('arrow') === 0) e.preventDefault();
  if (k === 'p') togglePause();
  if (k === 'v') toggleMode();
  if (k === 'e') tryEnterExit();
  if (k === 'g') setPvp(!player.pvp);
  if (k === 'f') fireAction();
  if (k === 'b') setToggle('box');
  if (k === 't') setToggle('trk');
  if (k === 'l') setToggle('lbl');
  if (k === 'c'){
    if (mode === 'player'){ camFP = !camFP; syncBtns(); }
    else { autoCam = !autoCam; tween = null; pTimer = 0; syncBtns(); }
  }
  if (k === '1') setSpeed(1);
  if (k === '2') setSpeed(60);
  if (k === '3') setSpeed(300);
});
window.addEventListener('keyup', function(e){ keysDown[e.key.toLowerCase()] = false; });
function toggleMode(){
  mode = mode === 'player' ? 'drone' : 'player';
  if (mode === 'player'){
    rigP.az = player.ry + Math.PI;   // camera settles behind the character
  } else {
    if (document.exitPointerLock) document.exitPointerLock();
    player.av.g.visible = !player.veh && !player.heli;   // FP hid it
  }
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
  bFP: document.getElementById('bFP'), bMenu: document.getElementById('bMenu'),
  tray: document.getElementById('tray'),
  bSnd: document.getElementById('bSnd'), bScores: document.getElementById('bScores'),
  scores: document.getElementById('scores'),
  s1: document.getElementById('s1'), s60: document.getElementById('s60'), s300: document.getElementById('s300')
};
els.ncars.textContent = cars.length; els.npeds.textContent = peds.length;
function syncBtns(){
  els.bView.classList.toggle('on', mode === 'drone');
  els.bNerf.classList.toggle('on', player.pvp);
  els.bFP.classList.toggle('on', camFP);
  els.bAuto.classList.toggle('on', autoCam);
  els.bBox.classList.toggle('on', show.box);
  els.bTrk.classList.toggle('on', show.trk);
  els.bLbl.classList.toggle('on', show.lbl);
  els.bPause.classList.toggle('on', paused);
  els.bPause.textContent = paused ? '>' : '||';
  els.s1.classList.toggle('on', speed === 1 && !paused);
  els.s60.classList.toggle('on', speed === 60 && !paused);
  els.s300.classList.toggle('on', speed === 300 && !paused);
  els.bMenu.classList.toggle('on', !els.tray.hidden);
  els.bSnd.classList.toggle('on', sndOn);
  els.bSnd.textContent = sndOn ? 'SND ON' : 'SND OFF';
  els.camlabel.textContent = mode === 'player'
    ? (camFP ? 'CAM-FP · ' : 'CAM-FOLLOW · ') + myName
    : 'CAM-ORBIT · ' + (autoCam ? 'AUTO' : 'MANUAL');
}
function setToggle(k){ show[k] = !show[k]; syncBtns(); }
function setSpeed(s){ speed = s; paused = false; syncBtns(); }
function togglePause(){ paused = !paused; syncBtns(); }
els.bView.onclick = toggleMode;
els.bCar.onclick = tryEnterExit;
els.bNerf.onclick = function(){ setPvp(!player.pvp); };
els.bFP.onclick = function(){
  if (mode !== 'player') toggleMode();
  camFP = !camFP; syncBtns();
};
els.bMenu.onclick = function(){ els.tray.hidden = !els.tray.hidden; syncBtns(); };
els.bSnd.onclick = function(){ pokeAudio(); setSnd(!sndOn); };
els.bScores.onclick = function(){ showScores(0); };
document.getElementById('scoreClose').onclick = function(){ els.scores.hidden = true; };
els.scores.addEventListener('pointerdown', function(e){ if (e.target === els.scores) els.scores.hidden = true; });
els.bFire.addEventListener('pointerdown', function(){
  fireTouchHeld = true;
  if (!player.heli) fireAction();
});
els.bJump.addEventListener('pointerdown', function(){
  if (player.veh && player.veh.plow){ toggleBlade(); return; }
  jumpQueued = true; stick.jets = true;
});
window.addEventListener('pointerup', function(){ stick.jets = false; fireTouchHeld = false; });
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
  if (mode === 'player' && !player.veh &&
      (player.pvp || player.heli || missionFight() || (myRpg > 0 && heliActive()) || camFP)){   // crosshair
    ov.fillStyle = 'rgba(255,157,90,0.95)';
    ov.fillRect(vw / 2 - 1.5, vh / 2 - 1.5, 3, 3);
    if (ads){
      ov.strokeStyle = 'rgba(255,157,90,0.8)'; ov.lineWidth = 1.2;
      ov.beginPath(); ov.arc(vw / 2, vh / 2, 11, 0, Math.PI * 2); ov.stroke();
    }
  }
  var nowHm = performance.now();
  if (nowHm - hitMarkAt < 320){   // hitmarker: four ticks kick out from the crosshair
    var hmA = 1 - (nowHm - hitMarkAt) / 320;
    var r0 = 6 + (1 - hmA) * 5, r1 = r0 + 7;
    ov.strokeStyle = 'rgba(140,240,255,' + (0.95 * hmA) + ')';
    ov.lineWidth = 2;
    ov.beginPath();
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function(q){
      ov.moveTo(vw / 2 + q[0] * r0, vh / 2 + q[1] * r0);
      ov.lineTo(vw / 2 + q[0] * r1, vh / 2 + q[1] * r1);
    });
    ov.stroke();
  }
  if (nowHm - hitMarkAt < 950 && hitMarkName)
    chip(vw / 2 - 30, vh / 2 - 22, 'TAGGED ' + hitMarkName, '#8ef7ff');
  if (mode === 'player' && isFrozen()){   // icy vignette while frozen
    var fLeft = (player.frozenUntil - nowHm) / 4000;
    ov.strokeStyle = 'rgba(140,210,255,' + (0.2 + 0.3 * Math.min(1, fLeft)) + ')';
    ov.lineWidth = 30;
    ov.strokeRect(0, 0, vw, vh);
    ov.lineWidth = 10;
    ov.strokeStyle = 'rgba(210,240,255,0.35)';
    ov.strokeRect(12, 12, vw - 24, vh - 24);
  }
  if (!heli.down){   // news chopper tag + hp
    var hDist = camPos.distanceTo(_v.set(heli.x, heli.y, heli.z));
    if (hDist < 900){
      var hTag = project(heli.x, heli.y + 3.4, heli.z);
      if (hTag){
        var hTxt = 'LEX NEWS CHOPPER' + (heliActive() ? ' · HP ' + heli.hp + '/3' : '');
        ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
        chip(hTag[0] - ov.measureText(hTxt).width / 2, hTag[1], hTxt,
          heliActive() ? '#ff9d5a' : '#ffd28a');
      }
    }
  }
  if (mh && mh.mesh.visible && !mh.boomed){   // mission chopper tag
    var mTag = project(mh.x, mh.y + 3.4, mh.z);
    if (mTag){
      var mTxt = 'LEX NEWS CHOPPER (LIVE)' + (mh.alive ? ' · HP ' + mh.hp + '/3' : '');
      ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
      chip(mTag[0] - ov.measureText(mTxt).width / 2, mTag[1], mTxt, '#ff5f52');
    }
  }
  var tTxt = null;
  if (mission.stage === 'fight')
    tTxt = 'THE RIBBON CUTTING · ' + ((performance.now() - mission.t0f) / 1000).toFixed(1) + 's';
  else if (mission2.stage === 'plow' && mission2.t0)
    tTxt = 'SNOW EMERGENCY · ' + ((performance.now() - mission2.t0) / 1000).toFixed(1) + 's' +
      (mission2.penalty ? ' · +' + mission2.penalty + 's PENALTY' : '');
  if (tTxt){   // mission timer, top center
    ov.font = '12px ui-monospace, Menlo, Consolas, monospace';
    var tw3 = ov.measureText(tTxt).width;
    ov.fillStyle = 'rgba(2,8,10,0.62)';
    ov.fillRect(vw / 2 - tw3 / 2 - 8, 12, tw3 + 16, 20);
    ov.fillStyle = '#ffd28a';
    ov.fillText(tTxt, vw / 2 - tw3 / 2, 26);
  }
  if (mission2.stage === 'plow'){   // snow zone markers + the forbidden street
    ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
    for (k = 0; k < SNOW_ZONES.length; k++){
      var zs = zoneState[k];
      if (!zs || zs.done) continue;
      var zn = SNOW_ZONES[k];
      var zcx = zn.axis === 'x' ? (zn.lo + zn.hi) / 2 : zn.c;
      var zcz = zn.axis === 'x' ? zn.c : (zn.lo + zn.hi) / 2;
      var zp = project(zcx, 4, zcz);
      if (!zp) continue;
      var pct = zs.total ? Math.round(zs.cleared / zs.total * 100) : 0;
      chip(zp[0] - 24, zp[1], zn.name + ' ' + pct + '%', '#8ef7ff');
    }
    if (plowVeh && player.veh !== plowVeh){
      var pv = project(plowVeh.g.position.x, plowVeh.g.position.y + 4, plowVeh.g.position.z);
      if (pv) chip(pv[0] - 26, pv[1], 'SNOW PLOW', '#ffd28a');
    }
    var rp2 = project((REDDIT_ZONE.lo + REDDIT_ZONE.hi) / 2, 4, REDDIT_ZONE.c);
    if (rp2) chip(rp2[0] - 52, rp2[1], "MAYOR'S ST — DO NOT PLOW", '#ff5f52');
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
  updateHeli(dt);
  updateMission(dt);
  updateMission2(dt);
  updateRockets(dt);
  updateDrops(dt);
  updatePuffs(dt);
  updatePickups(dt);
  updateRotorSnd();
  netTick(dt);
  diagTick(dt);
  if (mode === 'drone'){
    applyWASD(dt);
    updateRig(dt);
  } else updatePlayerCam(dt);

  // environment
  var env = envAt(simH);
  if (m2Sky > 0.01){   // snowstorm: overcast blend
    skyC.lerp(_snowSkyC, m2Sky);
    fogC.lerp(_snowSkyC, m2Sky);
    env.sun *= 1 - 0.75 * m2Sky;
    env.hemi = env.hemi * (1 - m2Sky) + 0.55 * m2Sky;
  }
  renderer.setClearColor(skyC);
  scene.fog.color.copy(fogC);
  scene.fog.density = 0.0007 + env.night * 0.00045 + m2Sky * 0.0012;
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
    if (isFrozen()) hint = 'FROZEN' + (frozenByName ? ' BY ' + frozenByName : '') + ' — ' + Math.ceil((player.frozenUntil - performance.now()) / 1000) + 's';
    else if (missionFight()) hint = 'SHOOT DOWN THE CHOPPER · F/CLICK — FIRE · RMB — AIM · CHOPPER HP ' + mh.hp + '/3';
    else if (player.heli) hint = 'W/S A/D FLY · SPACE UP · SHIFT DOWN · HOLD F/CLICK — WATER CANNON · E — EXIT · HP ' + heli.hp + '/3';
    else if (player.veh && player.veh.plow) hint = 'BLADE: ' + (bladeDown ? 'DOWN' : 'UP') + ' · SPACE — RAISE/LOWER · CLEAR THE SNOWY STREETS · E — EXIT';
    else if (player.veh) hint = 'E — EXIT · W/S DRIVE · A/D STEER · ' + Math.round(Math.abs(player.veh.spd) * 3.6) + ' KM/H';
    else if (mission2.stage === 'plow' && plowVeh) hint = 'GET TO THE PLOW — MAIN ST BY CITY HALL (E TO BOARD)';
    else if (mission.stage === 'idle' && mission2.stage === 'idle' && nearMissionTrig()) hint = 'E — START MISSION: THE RIBBON CUTTING';
    else if (heliUnlocked && mission.stage === 'idle' && mission2.stage === 'idle' && nearDoor()) hint = 'E — CITY HALL: SEE THE MAYOR';
    else if (!heliUnlocked && nearDoor()) hint = 'CITY HALL IS LOCKED — BEAT "THE RIBBON CUTTING" FIRST';
    else if (canEnterHeli()) hint = 'E — FLY THE NEWS CHOPPER';
    else if (!heliUnlocked && canEnterHeliBase()) hint = 'LOCKED — BEAT "THE RIBBON CUTTING" AT CITY HALL TO FLY';
    else if (player.grounded && nearestVehicle()) hint = 'E — ENTER CAR';
    else if (!player.grounded && player.thrusting) hint = 'JETPACK · FUEL ' + Math.round(player.fuel) + '%';
    else if (myRpg > 0 && heliActive()) hint = 'RPG ×' + myRpg + ' · F/CLICK — FIRE AT THE CHOPPER · RMB — AIM';
    else if (player.pvp) hint = 'CLICK/F — FIRE · RMB — AIM · G — HOLSTER';
  }
  els.hint.textContent = hint;
  els.hint.style.display = hint ? 'block' : 'none';

  renderer.render(scene, camera);
  drawOverlay();
}
requestAnimationFrame(frame);
})();

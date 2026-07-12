(function(){
'use strict';
/* LEXTOWN-01 — stylized downtown Lexington, KY block simulator.
   Real street grid, landmark massing, agent traffic + peds, day/night, detection HUD. */

// ---------- renderer / scene ----------
var glCanvas = document.getElementById('gl');
var IS_COARSE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
// deterministic integer hash (F3 weather) needs Math.imul; polyfill for old engines
if (!Math.imul) Math.imul = function(a, b){ var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff; return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0; };
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
var X0 = -720, X1 = 820, Z0 = -1500, Z1 = 1000;   // map extents
// dirs: EW +1 = eastbound(+x); NS +1 = southbound(+z)
// Streets can carry a partial extent (x0/x1 on EW, z0/z1 on NS) so they end
// where they really end — MLK and Upper stop at Euclid, Mill at Maxwell,
// Rose starts at Main — instead of slicing through the UK superblock.
// EW must stay sorted north→south (the block loop pairs consecutive rows);
// NS must stay sorted west→east for the same reason.
// New Circle Rd is a full beltline loop (belt:true on all four legs): the
// northern leg (z=-950) is the Urban Service Boundary, a southern leg (z=900)
// and east/west legs (x=720 / x=-620) close the ring around the built city.
// Each leg carries partial extents so the four legs terminate at the corners.
// The loop is sidewalk-free and open-shouldered: belt legs are skipped by both
// pedStreets and the block-fill loop, so the fringe between the outer grid and
// the beltline stays grass. Full-extent grid streets run out to cross the legs
// (that is how the loop hooks into the grid). North of the USB there is no grid
// — Broadway continues as Paris Pike, Limestone as Russell Cave Rd, and the
// horse farms are hand-built.
var EW = [
  {name:'NEW CIRCLE RD', z:-950, dirs:[1,-1], x0:-620, x1:720, belt:true},  // north leg / USB
  {name:'LOUDON AVE',    z:-800, dirs:[1,-1], x0:-200, x1:200},
  {name:'SEVENTH ST',    z:-700, dirs:[1],    x0:-200, x1:200},
  {name:'SIXTH ST',      z:-600, dirs:[-1],   x0:-200, x1:200},
  {name:'FIFTH ST',      z:-500, dirs:[1],    x0:-200, x1:200},
  {name:'FOURTH ST',     z:-400, dirs:[-1],   x0:-200, x1:200},
  {name:'THIRD ST',   z:-300, dirs:[1,-1]},
  {name:'SECOND ST',  z:-200, dirs:[-1]},
  {name:'SHORT ST',   z:-100, dirs:[1]},
  {name:'MAIN ST',    z:0,    dirs:[1]},
  {name:'VINE ST',    z:100,  dirs:[-1]},
  {name:'HIGH ST',    z:200,  dirs:[1,-1]},
  {name:'MAXWELL ST', z:300,  dirs:[1],    x0:-200, x1:300},
  {name:'EUCLID AVE', z:400,  dirs:[1,-1], x0:100},
  {name:'NEW CIRCLE RD', z:900, dirs:[1,-1], x0:-620, x1:720, belt:true}  // south leg
];
var NS = [
  {name:'NEW CIRCLE RD', x:-620, dirs:[1,-1], z0:-950, z1:900, belt:true}, // west leg
  {name:'BROADWAY',  x:-200, dirs:[1,-1]},                    // Paris Pike up north
  {name:'MILL ST',   x:-100, dirs:[-1],  z0:-400, z1:300},
  {name:'UPPER ST',  x:0,    dirs:[-1],  z0:-800, z1:400},
  {name:'LIMESTONE', x:100,  dirs:[1]},                        // Russell Cave up north
  {name:'MLK BLVD',  x:200,  dirs:[1,-1], z0:-800, z1:400},
  {name:'ROSE ST',   x:300,  dirs:[1,-1], z0:0},
  {name:'WOODLAND',  x:400,  dirs:[1,-1], z0:0, z1:400},
  {name:'ASHLAND',   x:500,  dirs:[1,-1], z0:200},
  {name:'NEW CIRCLE RD', x:720, dirs:[1,-1], z0:-950, z1:900, belt:true}   // east leg
];
function ewLo(s){ return s.x0 === undefined ? X0 : s.x0; }
function ewHi(s){ return s.x1 === undefined ? X1 : s.x1; }
function nsLo(s){ return s.z0 === undefined ? Z0 : s.z0; }
function nsHi(s){ return s.z1 === undefined ? Z1 : s.z1; }
// do these two streets actually cross?
function meets(e, n){
  return n.x >= ewLo(e) - 1 && n.x <= ewHi(e) + 1 &&
         e.z >= nsLo(n) - 1 && e.z <= nsHi(n) + 1;
}
var XINGS = [];
EW.forEach(function(e){ NS.forEach(function(n){ if (meets(e, n)) XINGS.push({e: e, n: n}); }); });

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
  var lo = ewLo(s), hi = ewHi(s);
  var t = roadTexH.clone(); t.needsUpdate = true; t.repeat.set((hi - lo) / 60, 1);
  var m = new THREE.Mesh(new THREE.PlaneGeometry(hi - lo, SW),
    new THREE.MeshStandardMaterial({map: t, roughness: 0.95}));
  m.rotation.x = -Math.PI / 2; m.position.set((lo + hi) / 2, 0.05, s.z);
  m.receiveShadow = true; scene.add(m);
});
NS.forEach(function(s){
  var lo = nsLo(s), hi = nsHi(s);
  var t = roadTexV.clone(); t.needsUpdate = true; t.repeat.set(1, (hi - lo) / 60);
  var m = new THREE.Mesh(new THREE.PlaneGeometry(SW, hi - lo),
    new THREE.MeshStandardMaterial({map: t, roughness: 0.95}));
  m.rotation.x = -Math.PI / 2; m.position.set(s.x, 0.1, (lo + hi) / 2);
  m.receiveShadow = true; scene.add(m);
});
// intersection patches with crosswalks
(function(){
  var g = new THREE.PlaneGeometry(SW + 7, SW + 7);
  var mat = new THREE.MeshStandardMaterial({map: xwalkTex, roughness: 0.95});
  var im = new THREE.InstancedMesh(g, mat, XINGS.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  var i = 0, one = new THREE.Vector3(1, 1, 1);
  XINGS.forEach(function(xg){
    M.compose(new THREE.Vector3(xg.n.x, 0.15, xg.e.z), q, one);
    im.setMatrixAt(i++, M);
  });
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
function procBlock(x0, z0, x1, z1, low){
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
    var h = low ? 6 + Math.random() * 10 :
            r < 0.62 ? 8 + Math.random() * 12 : r < 0.9 ? 18 + Math.random() * 18 : 40 + Math.random() * 26;
    var vi = h > 38 ? (Math.random() < 0.5 ? 5 : 4) : (Math.random() * 4) | 0;
    var bx = (px0 + px1) / 2, bz = (pz0 + pz1) / 2;
    addTower(bx, bz, w, d, h, vi);
    var retail = (low || Math.abs(bz) < 160) && MASONRY[vi] && h < 28;
    if (retail) addStorefront(bx, bz, w, d);
    if (Math.random() < 0.5 && retail){
      var south = bz > 0;
      addSign(bx - w / 4 + Math.random() * (w / 2), 5.2,
        south ? bz - d / 2 - 0.55 : bz + d / 2 + 0.55, 0);
    }
  }
}

// ---------- residential blocks (bungalows — south + east neighborhoods) ----------
var lawnMat = new THREE.MeshStandardMaterial({color: 0x51683c, roughness: 1});
var HOUSE_COLS = [0xe8e2d4, 0x9c5240, 0xb9c4c9, 0xcdb98e, 0x8fa3b5, 0x76806f];
var ROOF_COLS = [0x3a3d42, 0x4a3b32, 0x2f3a33];
var housePts = [];   // {x,z,ry,w,d,h,rh,ci,ri} — instanced after world build
function house(x, z, ry, narrow){
  // narrow = NoLi-style shotgun: skinny frontage, deep, low
  var w = narrow ? 6 + Math.random() * 1.5 : 9 + Math.random() * 3.5;
  var d = narrow ? 10 + Math.random() * 2.5 : 7.5 + Math.random() * 3;
  var h = narrow ? 3.8 + Math.random() : 4.2 + Math.random() * 1.8;
  housePts.push({x: x, z: z, ry: ry, w: w, d: d, h: h,
                 rh: (narrow ? 1.8 : 2.2) + Math.random() * (narrow ? 0.8 : 1.4),
                 ci: (Math.random() * HOUSE_COLS.length) | 0,
                 ri: (Math.random() * ROOF_COLS.length) | 0});
  var flip = Math.abs(Math.sin(ry)) > 0.5;   // ±90° — swap footprint for the collider
  var cw = flip ? d : w, cd = flip ? w : d;
  colliders.push({x0: x - cw / 2, x1: x + cw / 2, z0: z - cd / 2, z1: z + cd / 2, h: h + 0.7});
}
function resBlock(x0, z0, x1, z1, narrow){
  var w = x1 - x0, d = z1 - z0;
  if (w > 135 || d > 135){   // subdivide superblocks; 14 m grass gaps read as alleys
    var nx = Math.max(w > 135 ? 2 : 1, Math.round(w / 110));
    var nz = Math.max(d > 135 ? 2 : 1, Math.round(d / 110));
    var cw = w / nx, cd = d / nz;
    for (var a = 0; a < nx; a++) for (var b = 0; b < nz; b++)
      resBlock(x0 + a * cw + (a ? 7 : 0), z0 + b * cd + (b ? 7 : 0),
               x0 + (a + 1) * cw - (a < nx - 1 ? 7 : 0), z0 + (b + 1) * cd - (b < nz - 1 ? 7 : 0),
               narrow);
    return;
  }
  slab(x0, z0, x1, z1, lawnMat);
  var step = narrow ? 10 : 15, jit = narrow ? 3 : 6, off = narrow ? 8.5 : 7.5;
  var k;
  if (w >= d){   // two rows of houses facing the z edges
    for (var hx = x0 + 9; hx < x1 - 8; hx += step + Math.random() * jit){
      if (Math.random() < 0.86) house(hx, z0 + off, Math.PI, narrow);
      else treePts.push([hx, z0 + 7 + Math.random() * 5]);
    }
    if (d > 42) for (hx = x0 + 9; hx < x1 - 8; hx += step + Math.random() * jit){
      if (Math.random() < 0.86) house(hx, z1 - off, 0, narrow);
      else treePts.push([hx, z1 - 12 + Math.random() * 5]);
    }
  } else {       // two columns facing the x edges
    for (var hz = z0 + 9; hz < z1 - 8; hz += step + Math.random() * jit){
      if (Math.random() < 0.86) house(x0 + off, hz, Math.PI / 2, narrow);
      else treePts.push([x0 + 7 + Math.random() * 5, hz]);
    }
    if (w > 42) for (hz = z0 + 9; hz < z1 - 8; hz += step + Math.random() * jit){
      if (Math.random() < 0.86) house(x1 - off, hz, -Math.PI / 2, narrow);
      else treePts.push([x1 - 12 + Math.random() * 5, hz]);
    }
  }
  for (k = 0; k < 3; k++)   // backyard canopy
    treePts.push([x0 + 14 + Math.random() * (w - 28), z0 + 14 + Math.random() * (d - 28)]);
}
// which generator a grid cell gets, by its center
function blockKind(cx, cz){
  if (cz < -350) return Math.random() < 0.3 ? 'low' : 'shotgun';  // NoLi corridor
  if (cz > 200){
    if (cx > 100 && cx < 300) return 'low';   // S Lime student strip
    return 'res';
  }
  if (cx > 200) return cz > -150 && Math.random() < 0.45 ? 'low' : 'res';  // east side
  return 'proc';
}

// blocks between streets; skip hand-built landmark blocks. Keyed by
// "<west NS street>|<north EW street>" so table edits don't shift them.
var SKIP = {
  'BROADWAY|SHORT ST': 1,     // Victorian Square
  'BROADWAY|MAIN ST': 1,      // Triangle Park + Big Blue
  'BROADWAY|VINE ST': 1,
  'MILL ST|THIRD ST': 1,      // First Presbyterian
  'MILL ST|SHORT ST': 1,      // 21c
  'MILL ST|MAIN ST': 1,       // City Center
  'MILL ST|VINE ST': 1,
  'UPPER ST|SHORT ST': 1,     // old courthouse
  'LIMESTONE|SHORT ST': 1,    // Circuit Court
  'LIMESTONE|MAIN ST': 1,     // Phoenix Park + City Hall
  'MLK BLVD|MAIN ST': 1,      // Thoroughbred Park
  'ROSE ST|HIGH ST': 1,       // Woodland Park
  'ROSE ST|MAXWELL ST': 1,
  'LIMESTONE|SIXTH ST': 1     // Al's Bar + Duncan Park
};
for (var i = 0; i < NS.length - 1; i++){
  for (var j = 0; j < EW.length - 1; j++){
    var bx0 = NS[i].x + SW / 2 + 3, bx1 = NS[i + 1].x - SW / 2 - 3;
    var bz0 = EW[j].z + SW / 2 + 3, bz1 = EW[j + 1].z - SW / 2 - 3;
    // beltline legs bound the outer ring; leave that fringe open (grass), never
    // fill it with towers/houses — keeps edge-of-town sparse and authentic.
    if (EW[j].belt || EW[j + 1].belt || NS[i].belt || NS[i + 1].belt) continue;
    if (SKIP[NS[i].name + '|' + EW[j].name]) continue;
    // all four bounding street segments must exist here (partial extents);
    // uncovered regions (campus, Chevy Chase, NE side) are hand-built below
    if (!meets(EW[j], NS[i]) || !meets(EW[j], NS[i + 1]) ||
        !meets(EW[j + 1], NS[i]) || !meets(EW[j + 1], NS[i + 1])) continue;
    var kind = blockKind((bx0 + bx1) / 2, (bz0 + bz1) / 2);
    if (kind === 'res') resBlock(bx0, bz0, bx1, bz1);
    else if (kind === 'shotgun') resBlock(bx0, bz0, bx1, bz1, true);
    else procBlock(bx0, bz0, bx1, bz1, kind === 'low');
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

// ---------- UK campus (south of Euclid, Limestone→Rose) ----------
var whiteTrimMat = new THREE.MeshStandardMaterial({color: 0xe9e5da, roughness: 0.7});
(function(){
  slab(108, 408, 292, 792, parkMat);          // the quad / Bowl greens
  // paved walks: thin planes floated above the lawn (coplanar slabs z-fight)
  [[196, 408, 204, 792], [108, 596, 292, 604]].forEach(function(wk){
    var m = new THREE.Mesh(new THREE.PlaneGeometry(wk[2] - wk[0], wk[3] - wk[1]), slabMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((wk[0] + wk[2]) / 2, 0.74, (wk[1] + wk[3]) / 2);
    m.receiveShadow = true; scene.add(m);
  });
  // Memorial Coliseum — white box + barrel-vault roof, fronting Euclid
  addTower(146, 442, 46, 28, 13, 2, 'MEMORIAL COLISEUM');
  var barrel = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 45, 18), whiteTrimMat);
  barrel.rotation.z = Math.PI / 2;            // axis along x; local x is now vertical
  barrel.scale.set(0.42, 1, 1);
  barrel.position.set(146, 13.6, 442); barrel.castShadow = true; scene.add(barrel);
  // Gatton Student Center — glass, bookstore band
  addTower(246, 440, 52, 26, 11, 9, 'GATTON STUDENT CENTER');
  addStorefront(246, 440, 52, 26);
  // Main Building — brick + white cupola
  addTower(150, 520, 22, 16, 15, 0, 'UK MAIN BUILDING');
  var mbDrum = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3.4, 10), whiteTrimMat);
  mbDrum.position.set(150, 17.5, 520); mbDrum.castShadow = true; scene.add(mbDrum);
  var mbCone = new THREE.Mesh(new THREE.ConeGeometry(3, 2.8, 10), roofDark);
  mbCone.position.set(150, 20.6, 520); scene.add(mbCone);
  // Memorial Hall — brick chapel, white steeple (the UK icon)
  addTower(206, 558, 14, 11, 8, 0, 'MEMORIAL HALL');
  var mhTower = new THREE.Mesh(new THREE.BoxGeometry(4.5, 12, 4.5), whiteTrimMat);
  mhTower.position.set(206, 8 + 6, 552); mhTower.castShadow = true; scene.add(mhTower);
  var mhSpire = new THREE.Mesh(new THREE.ConeGeometry(3.1, 9, 8), whiteTrimMat);
  mhSpire.position.set(206, 24.5, 552); mhSpire.castShadow = true; scene.add(mhSpire);
  // Patterson Office Tower + White Hall
  addTower(258, 528, 17, 15, 62, 2, 'PATTERSON OFFICE TOWER');
  addTower(258, 572, 26, 13, 22, 4);
  // W.T. Young Library — big brick + rotunda
  addTower(206, 688, 50, 40, 14, 0, 'WILLIAM T. YOUNG LIBRARY');
  var rot = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 7, 16),
    new THREE.MeshStandardMaterial({color: 0x9c5240, roughness: 0.9}));
  rot.position.set(206, 17.5, 688); rot.castShadow = true; scene.add(rot);
  var rotRoof = new THREE.Mesh(new THREE.ConeGeometry(9.6, 4.5, 16), roofDark);
  rotRoof.position.set(206, 23.2, 688); scene.add(rotRoof);
  // dorm / classroom filler
  addTower(126, 630, 16, 30, 24, 1);
  addTower(126, 730, 16, 26, 24, 1);
  addTower(270, 744, 20, 20, 34, 4);
  labels.push({name: 'UNIVERSITY OF KENTUCKY', x: 200, y: 46, z: 600});
  for (var t = 0; t < 34; t++)
    treePts.push([112 + Math.random() * 176, 412 + Math.random() * 376]);
})();

// Kroger Field (southwest of campus, off S Broadway) + tailgate lots
(function(){
  slab(-310, 548, -70, 772);
  var podium = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 48),
    new THREE.MeshStandardMaterial({color: 0x8a8478, roughness: 0.9}));
  podium.scale.set(104, 1, 92); podium.position.set(-190, 3.7, 660); scene.add(podium);
  var bowl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 13, 48),
    new THREE.MeshStandardMaterial({color: 0xe8e8e2, roughness: 0.6}));
  bowl.scale.set(94, 1, 82); bowl.position.set(-190, 12.7, 660);
  bowl.castShadow = true; bowl.receiveShadow = true; scene.add(bowl);
  var band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.6, 48),
    regNight(new THREE.MeshStandardMaterial({color: 0x0033a0,
      emissive: 0x2a6cff, emissiveIntensity: 0}), 1.8));
  band.scale.set(95, 1, 83); band.position.set(-190, 20.3, 660); scene.add(band);
  labels.push({name: 'KROGER FIELD', x: -190, y: 32, z: 660});
  colliders.push({ell: 1, cx: -190, cz: 660, rx: 106, rz: 94, h: 21.6});
  addParkingLot(-300, 470, -180, 535);
  addParkingLot(-168, 470, -80, 535);
  // Scott St-ish lots + low brick between Broadway and Limestone
  addParkingLot(-40, 430, 60, 530);
  addTower(-120, 470, 40, 30, 10, 1);
  resBlock(-60, 560, 88, 790);   // student rentals east of the stadium
  for (var t = 0; t < 14; t++)
    treePts.push([-300 + Math.random() * 360, 420 + Math.random() * 350]);
})();

// S Broadway corridor west side — warehouses + scatter
(function(){
  addTower(-260, 340, 40, 24, 9, 4);
  addTower(-304, 430, 34, 26, 8, 1);
  resBlock(-460, 308, -330, 500);
  for (var t = 0; t < 18; t++)
    treePts.push([-500 + Math.random() * 270, 310 + Math.random() * 460]);
})();

// Thoroughbred Park (Main at MLK — bronze horses at full gallop)
(function(){
  slab(208, 8, 292, 92, parkMat);
  labels.push({name: 'THOROUGHBRED PARK', x: 250, y: 14, z: 50});
  var bronze = new THREE.MeshStandardMaterial({color: 0x5a4632, roughness: 0.5, metalness: 0.5});
  for (var h = 0; h < 5; h++){
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 1.1), bronze);
    body.position.y = 1.9; body.castShadow = true; g.add(body);
    var neck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.6), bronze);
    neck.position.set(1.7, 2.6, 0); neck.rotation.z = 0.7; g.add(neck);
    var head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.5), bronze);
    head.position.set(2.35, 3.05, 0); head.rotation.z = 0.25; g.add(head);
    for (var l = 0; l < 4; l++){
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.5, 0.26), bronze);
      leg.position.set(-1.2 + (l % 2) * 2.4, 0.85, l > 1 ? 0.32 : -0.32);
      leg.rotation.z = (l % 2 ? -0.5 : 0.55) * Math.random();
      g.add(leg);
    }
    g.position.set(216 + h * 9 + Math.random() * 3, 0.7, 32 + h * 7 + Math.random() * 4);
    g.rotation.y = Math.PI + 0.25;   // charging toward downtown, like the real one
    scene.add(g);
  }
  for (var t = 0; t < 8; t++)
    treePts.push([212 + Math.random() * 76, 12 + Math.random() * 76]);
})();

// Woodland Park (High & Woodland)
(function(){
  slab(308, 208, 392, 392, parkMat);
  labels.push({name: 'WOODLAND PARK', x: 350, y: 14, z: 300});
  var pad = new THREE.Mesh(new THREE.PlaneGeometry(40, 34), paverMat);  // pavilion pad
  pad.rotation.x = -Math.PI / 2; pad.position.set(350, 0.74, 305);
  pad.receiveShadow = true; scene.add(pad);
  var canopy = new THREE.Mesh(new THREE.BoxGeometry(20, 0.6, 12),
    new THREE.MeshStandardMaterial({color: 0x3d6e57, roughness: 0.7}));
  canopy.position.set(350, 6.3, 305); canopy.castShadow = true; scene.add(canopy);
  var civ = new THREE.MeshStandardMaterial({color: 0x9a938a, roughness: 0.85});
  for (var p = 0; p < 4; p++){
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6.3, 6), civ);
    pole.position.set(350 + (p % 2 ? 8 : -8), 3.1, 305 + (p > 1 ? 4.5 : -4.5));
    scene.add(pole);
  }
  for (var t = 0; t < 20; t++)
    treePts.push([312 + Math.random() * 76, 212 + Math.random() * 176]);
})();

// ---------- Chevy Chase ----------
(function(){
  // the strip: low brick storefronts on Euclid, Woodland→east edge
  slab(408, 408, 612, 446);
  var shops = [
    {x: 424, w: 26, vi: 0}, {x: 452, w: 22, vi: 2}, {x: 478, w: 24, vi: 1},
    {x: 506, w: 26, vi: 0, label: 'WHEELER PHARMACY'},
    {x: 536, w: 30, vi: 2}, {x: 572, w: 34, vi: 1}
  ];
  shops.forEach(function(s){
    var h = 7 + Math.random() * 3;
    addTower(s.x, 428, s.w, 26, h, s.vi, s.label);
    addStorefront(s.x, 428, s.w, 26);
    if (Math.random() < 0.7) addSign(s.x, 5.2, 414.2, 0);
  });
  labels.push({name: 'CHEVY CHASE', x: 500, y: 22, z: 428});
  // north-side shops (Euclid at Ashland corner)
  slab(408, 352, 492, 394);
  [{x: 424, w: 26, vi: 1}, {x: 454, w: 26, vi: 0}, {x: 481, w: 18, vi: 2}].forEach(function(s){
    addTower(s.x, 373, s.w, 26, 6.5 + Math.random() * 2.5, s.vi);
    addStorefront(s.x, 373, s.w, 26);
    if (Math.random() < 0.7) addSign(s.x, 5.2, 387.8, 0);
  });
  addParkingLot(412, 452, 528, 490);    // lot behind the strip
  // apartments row on Euclid near Rose (south side)
  slab(308, 408, 392, 444);
  addTower(330, 426, 36, 24, 12, 1); addStorefront(330, 426, 36, 24);
  addTower(370, 426, 28, 24, 10, 0); addStorefront(370, 426, 28, 24);
})();

// Ashland — the Henry Clay estate (wooded lawn, brick mansion)
(function(){
  slab(508, 500, 612, 792, parkMat);
  addTower(560, 610, 26, 15, 10, 0, 'ASHLAND · HENRY CLAY ESTATE');
  var cup = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 8), whiteTrimMat);
  cup.position.set(560, 11.9, 610); scene.add(cup);
  var drive = new THREE.Mesh(new THREE.CircleGeometry(10, 20), paverMat);
  drive.rotation.x = -Math.PI / 2; drive.position.set(560, 0.74, 585);
  drive.receiveShadow = true; scene.add(drive);
  for (var t = 0; t < 26; t++)
    treePts.push([512 + Math.random() * 96, 505 + Math.random() * 282]);
})();

// bungalow neighborhoods (hand-placed where the grid has no streets)
resBlock(-192, 308, -8, 392);        // south of Maxwell, Broadway→Upper
resBlock(308, 452, 492, 792);        // Chevy Chase bungalows south of Euclid
resBlock(536, 452, 612, 492);        // behind the strip, east
resBlock(508, 208, 612, 392);        // east of Ashland Ave, north of Euclid
resBlock(408, 8, 612, 92);           // Woodland/Kentucky Ave blocks
resBlock(408, 108, 612, 192);
// NE side (MLK→edge, Third→Main) — band per street row
resBlock(208, -392, 612, -308);
resBlock(208, -292, 612, -208);
resBlock(208, -192, 612, -108);
resBlock(208, -92, 612, -8);

// ---------- NoLi — the North Limestone corridor ----------
// Al's Bar (Sixth & Lime) + Duncan Park share the skipped cell
(function(){
  slab(116, -592, 184, -566);
  addTower(128, -580, 18, 14, 7, 0, "AL'S BAR");
  addStorefront(128, -580, 18, 14);
  addSign(128, 5.2, -587.6, 0);
  house(160, -582, 0, true); house(176, -582, 0, true);
  slab(116, -562, 184, -508, parkMat);
  labels.push({name: 'DUNCAN PARK', x: 150, y: 12, z: -535});
  for (var t = 0; t < 8; t++)
    treePts.push([120 + Math.random() * 60, -558 + Math.random() * 46]);
})();
// Jefferson St side — shotguns fill Broadway→Upper (no Mill up here)
resBlock(-192, -792, -8, -408, true);
// east of MLK, Third→Loudon — superblock bands
resBlock(208, -792, 612, -408);
// Loudon→New Circle: warehouses + Castlewood Park
(function(){
  slab(-192, -936, -8, -812);
  addTower(-140, -880, 60, 42, 10, 4);
  addTower(-50, -866, 34, 28, 8, 1);
  addParkingLot(-100, -830, -16, -816);
  slab(8, -936, 92, -812);
  addTower(50, -876, 46, 36, 9, 4);
  addParkingLot(14, -834, 86, -816);
  slab(108, -936, 192, -812, parkMat);   // Castlewood, east of N Lime
  labels.push({name: 'CASTLEWOOD PARK', x: 150, y: 14, z: -874});
  var deck = new THREE.Mesh(new THREE.PlaneGeometry(30, 17), slabMat);
  deck.rotation.x = -Math.PI / 2; deck.position.set(150, 0.73, -874);
  deck.receiveShadow = true; scene.add(deck);
  var pool = new THREE.Mesh(new THREE.PlaneGeometry(22, 11),
    new THREE.MeshStandardMaterial({color: 0x2e7d9e, roughness: 0.2, metalness: 0.3}));
  pool.rotation.x = -Math.PI / 2; pool.position.set(150, 0.74, -874); scene.add(pool);
  for (var t = 0; t < 14; t++)
    treePts.push([112 + Math.random() * 76, -932 + Math.random() * 116]);
  slab(208, -936, 470, -812);
  addTower(260, -880, 70, 44, 11, 4);
  addTower(380, -872, 50, 36, 9, 1);
  addParkingLot(320, -836, 460, -816);
  for (t = 0; t < 12; t++)
    treePts.push([480 + Math.random() * 130, -930 + Math.random() * 112]);
})();

// ---------- the horse farms (north of New Circle Rd — past the USB) ----------
var horsePts = [];   // {x,z,ry,s}
var railSegs = [], fencePostPts = [];
function fenceLine(x0, z0, x1, z1){   // axis-aligned black four-board fence
  var axis = z0 === z1 ? 'x' : 'z';
  var len = axis === 'x' ? x1 - x0 : z1 - z0;
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  [0.38, 0.72, 1.06, 1.4].forEach(function(y){
    railSegs.push({x: cx, z: cz, len: len, axis: axis, y: y});
  });
  var n = Math.floor(len / 3);
  for (var k = 0; k <= n; k++)
    fencePostPts.push(axis === 'x' ? [x0 + k * 3, z0] : [x0, z0 + k * 3]);
}
function paddock(x0, z0, x1, z1){
  fenceLine(x0, z0, x1, z0); fenceLine(x0, z1, x1, z1);
  fenceLine(x0, z0, x0, z1); fenceLine(x1, z0, x1, z1);
  var n = 3 + (Math.random() * 4) | 0;
  for (var k = 0; k < n; k++)
    horsePts.push({x: x0 + 10 + Math.random() * (x1 - x0 - 20),
                   z: z0 + 10 + Math.random() * (z1 - z0 - 20),
                   ry: Math.random() * Math.PI * 2, s: 0.8 + Math.random() * 0.35});
}
function barn(x, z, wallCol, roofCol, w, d, h){
  var wall = new THREE.MeshStandardMaterial({color: wallCol, roughness: 0.9});
  var box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
  box.position.set(x, h / 2 + 0.05, z);
  box.castShadow = true; box.receiveShadow = true; scene.add(box);
  var r = d * 0.62;
  var gable = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 3, 1),
    new THREE.MeshStandardMaterial({color: roofCol, roughness: 0.85}));
  gable.rotation.z = Math.PI / 2;      // length along x; local x is now vertical
  gable.scale.set(0.55, 1, 1);
  gable.position.set(x, h + 0.05, z); gable.castShadow = true; scene.add(gable);
  var cup = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.2), whiteTrimMat);
  cup.position.set(x, h + r * 0.55 + 0.5, z); scene.add(cup);
  colliders.push({x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2,
                  h: h + r * 0.55});
}
function pond(x, z, rx, rz){
  var m = new THREE.Mesh(new THREE.CircleGeometry(1, 22),
    new THREE.MeshStandardMaterial({color: 0x33566b, roughness: 0.25, metalness: 0.2}));
  m.rotation.x = -Math.PI / 2; m.scale.set(rx, rz, 1);
  m.position.set(x, 0.06, z); m.receiveShadow = true; scene.add(m);
}
(function(){
  // bluegrass pasture belt
  var pastureTex = makeTex(256, 256, function(g){
    g.fillStyle = '#4c6836'; g.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 900; i++){
      g.fillStyle = 'rgba(235,245,190,' + (Math.random() * 0.05) + ')';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1.5);
    }
    for (i = 0; i < 320; i++){
      g.fillStyle = 'rgba(15,35,8,0.09)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 3, 2);
    }
  });
  pastureTex.encoding = THREE.sRGBEncoding;
  pastureTex.repeat.set(11, 5);
  var belt = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 532),
    new THREE.MeshStandardMaterial({map: pastureTex, roughness: 1}));
  belt.rotation.x = -Math.PI / 2; belt.position.set((X0 + X1) / 2, 0.03, -1224);
  belt.receiveShadow = true; scene.add(belt);
  // continuous board fence along the USB (gaps at the two pikes)
  fenceLine(-510, -968, -218, -968);
  fenceLine(-182, -968, 82, -968);
  fenceLine(118, -968, 610, -968);
  labels.push({name: 'URBAN SERVICE BOUNDARY', x: -50, y: 16, z: -952});
  labels.push({name: 'PARIS PIKE', x: -200, y: 10, z: -1200});
  labels.push({name: 'RUSSELL CAVE RD', x: 100, y: 10, z: -1200});

  // Elmendorf (west of Paris Pike) — with the Green Hills mansion columns
  paddock(-505, -1480, -350, -1300);
  paddock(-330, -1480, -216, -1300);
  paddock(-505, -1270, -216, -1090);
  barn(-460, -1040, 0x241f1a, 0x3a3d42, 16, 10, 5);   // tobacco-black
  barn(-280, -1040, 0xe8e4d8, 0x3f7d72, 15, 9, 4.5);  // white + green roof
  pond(-380, -1350, 26, 18);
  labels.push({name: 'ELMENDORF FARM', x: -360, y: 20, z: -1200});
  (function(){   // the four white columns standing alone in the pasture
    for (var c = 0; c < 4; c++){
      var col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 7.5, 10), whiteTrimMat);
      col.position.set(-409 + c * 6, 3.8, -1180); col.castShadow = true; scene.add(col);
    }
    var lintel = new THREE.Mesh(new THREE.BoxGeometry(21, 1.1, 1.8), whiteTrimMat);
    lintel.position.set(-400, 8, -1180); lintel.castShadow = true; scene.add(lintel);
    colliders.push({x0: -410.5, x1: -389.5, z0: -1181.5, z1: -1178.5, h: 8.6});
  })();

  // Gainesway (between the pikes)
  paddock(-175, -1480, 75, -1310);
  paddock(-175, -1280, 75, -1080);
  barn(-120, -1030, 0xe8e4d8, 0x3f7d72, 15, 9, 4.5);
  barn(0, -1030, 0xe8e4d8, 0x3f7d72, 15, 9, 4.5);
  pond(20, -1400, 20, 14);
  labels.push({name: 'GAINESWAY FARM', x: -50, y: 20, z: -1180});

  // Mt. Brilliant (east of Russell Cave Rd)
  paddock(125, -1480, 295, -1230);
  barn(170, -1150, 0x241f1a, 0x3a3d42, 16, 10, 5);
  pond(240, -1120, 18, 13);
  labels.push({name: 'MT. BRILLIANT FARM', x: 210, y: 20, z: -1350});

  // Spendthrift (far east — Iron Works Pike side)
  paddock(330, -1480, 605, -1320);
  paddock(330, -1290, 605, -1060);
  barn(400, -1010, 0x7a2f26, 0x3a3d42, 16, 10, 5);    // red
  barn(480, -1010, 0xe8e4d8, 0x3f7d72, 15, 9, 4.5);
  pond(520, -1180, 24, 16);
  labels.push({name: 'SPENDTHRIFT FARM', x: 470, y: 20, z: -1380});

  // windbreak rows + pasture clumps
  for (var wx = -500; wx < 610; wx += 26)
    if (Math.random() < 0.8) treePts.push([wx + Math.random() * 8, -984 - Math.random() * 8]);
  for (var t = 0; t < 46; t++)
    treePts.push([X0 + 20 + Math.random() * (X1 - X0 - 40), -1480 + Math.random() * 490]);

  // fences (instanced: rails one draw, posts one draw)
  var fenceMat = new THREE.MeshStandardMaterial({color: 0x1d1b18, roughness: 0.9});
  var railIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.09, 0.07), fenceMat, railSegs.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(),
      s = new THREE.Vector3();
  for (var k = 0; k < railSegs.length; k++){
    var rs = railSegs[k];
    q.setFromEuler(e.set(0, rs.axis === 'z' ? Math.PI / 2 : 0, 0));
    M.compose(new THREE.Vector3(rs.x, rs.y, rs.z), q, s.set(rs.len, 1, 1));
    railIM.setMatrixAt(k, M);
  }
  railIM.castShadow = true; scene.add(railIM);
  var postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 1.5, 0.15), fenceMat, fencePostPts.length);
  q.set(0, 0, 0, 1);
  for (k = 0; k < fencePostPts.length; k++){
    M.compose(new THREE.Vector3(fencePostPts[k][0], 0.75, fencePostPts[k][1]), q, s.set(1, 1, 1));
    postIM.setMatrixAt(k, M);
  }
  postIM.castShadow = true; scene.add(postIM);

  // grazing horses (instanced per body part, per-instance coat colors)
  var HORSE_COLS = [0x51341f, 0x6e4526, 0x2e2118, 0xb9b3aa, 0x7b5a3a];
  function partM(px, py, pz, rz){
    var m = new THREE.Matrix4();
    if (rz) m.makeRotationZ(rz);
    m.setPosition(px, py, pz);
    return m;
  }
  var PARTS = [
    {g: new THREE.BoxGeometry(3.2, 1.15, 1.05), m: partM(0, 1.85, 0)},
    {g: new THREE.BoxGeometry(1.4, 0.65, 0.55), m: partM(1.75, 1.5, 0, -0.8)},   // neck, grazing
    {g: new THREE.BoxGeometry(0.95, 0.42, 0.48), m: partM(2.35, 0.95, 0, -0.35)}, // head down
    {g: new THREE.BoxGeometry(0.16, 0.85, 0.16), m: partM(-1.7, 1.45, 0, 0.3)},   // tail
    {g: new THREE.BoxGeometry(0.26, 1.35, 0.24), m: partM(1.15, 0.68, 0.3)},
    {g: new THREE.BoxGeometry(0.26, 1.35, 0.24), m: partM(1.15, 0.68, -0.3)},
    {g: new THREE.BoxGeometry(0.26, 1.35, 0.24), m: partM(-1.15, 0.68, 0.3)},
    {g: new THREE.BoxGeometry(0.26, 1.35, 0.24), m: partM(-1.15, 0.68, -0.3)}
  ];
  var coatMat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.85});
  var col = new THREE.Color();
  var coats = horsePts.map(function(){ return HORSE_COLS[(Math.random() * HORSE_COLS.length) | 0]; });
  PARTS.forEach(function(part){
    var im = new THREE.InstancedMesh(part.g, coatMat, horsePts.length);
    var W = new THREE.Matrix4();
    for (var h = 0; h < horsePts.length; h++){
      var p = horsePts[h];
      q.setFromEuler(e.set(0, p.ry, 0));
      W.compose(new THREE.Vector3(p.x, 0.05, p.z), q, s.set(p.s, p.s, p.s));
      W.multiply(part.m);
      im.setMatrixAt(h, W);
      im.setColorAt(h, col.setHex(coats[h]));
    }
    im.instanceColor.needsUpdate = true;
    im.castShadow = true; scene.add(im);
  });
})();

// ---------- New Circle Rd beltline labels ----------
// Green sign blades already auto-render 'NEW CIRCLE RD' at every crossing
// (from XINGS); these ambient labels only mark the long open stretches between
// crossings so the loop reads as one continuous road from a distance.
[[-410, -950], [470, -950],           // north leg (USB) — outside the Broadway/Lime blades
 [-410, 900], [610, 900],             // south leg
 [-620, -600], [-620, 560],           // west leg
 [720, -600], [720, 620]              // east leg
].forEach(function(p){
  labels.push({name: 'NEW CIRCLE RD', x: p[0], y: 11, z: p[1]});
});

// ---------- houses (instanced: one draw per siding color + roof color) ----------
(function(){
  if (!housePts.length) return;
  var bodyG = new THREE.BoxGeometry(1, 1, 1); bodyG.translate(0, 0.5, 0);
  var roofG = new THREE.ConeGeometry(1, 1, 4); roofG.translate(0, 0.5, 0);
  roofG.rotateY(Math.PI / 4);   // flats face the streets
  var sidingTex = makeTex(64, 64, function(g){
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.07)';
    for (var y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 1.2);
    g.fillStyle = '#232830';
    g.fillRect(8, 22, 12, 14); g.fillRect(44, 22, 12, 14);   // windows
    g.fillRect(28, 26, 9, 38);                               // door
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(8, 22, 12, 2); g.fillRect(44, 22, 12, 2);
  });
  sidingTex.encoding = THREE.sRGBEncoding;
  var winEm = makeTex(64, 64, function(g){
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffd9a4';
    if (Math.random() < 0.75) g.fillRect(8, 22, 12, 14);
    if (Math.random() < 0.55) g.fillRect(44, 22, 12, 14);
  });
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(),
      s = new THREE.Vector3();
  HOUSE_COLS.forEach(function(col, ci){
    var pts = housePts.filter(function(p){ return p.ci === ci; });
    if (!pts.length) return;
    var mat = new THREE.MeshStandardMaterial({color: col, map: sidingTex,
      emissiveMap: winEm, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9});
    regNight(mat, 0.55 + Math.random() * 0.3);
    var im = new THREE.InstancedMesh(bodyG, mat, pts.length);
    for (var k = 0; k < pts.length; k++){
      var p = pts[k];
      q.setFromEuler(e.set(0, p.ry, 0));
      M.compose(new THREE.Vector3(p.x, 0.7, p.z), q, s.set(p.w, p.h, p.d));
      im.setMatrixAt(k, M);
    }
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  });
  ROOF_COLS.forEach(function(col, ri){
    var pts = housePts.filter(function(p){ return p.ri === ri; });
    if (!pts.length) return;
    var im = new THREE.InstancedMesh(roofG,
      new THREE.MeshStandardMaterial({color: col, roughness: 1}), pts.length);
    for (var k = 0; k < pts.length; k++){
      var p = pts[k];
      q.setFromEuler(e.set(0, p.ry, 0));
      M.compose(new THREE.Vector3(p.x, 0.7 + p.h, p.z), q,
                s.set(p.w * 0.78, p.rh, p.d * 0.78));
      im.setMatrixAt(k, M);
    }
    im.castShadow = true; scene.add(im);
  });
})();

// street tree rows along Main + Vine + Euclid (continuous canopy)
[{z: 0, lo: -190, hi: 590}, {z: 100, lo: -190, hi: 590},
 {z: 400, lo: 112, hi: 590}].forEach(function(row){
  for (var tx = row.lo; tx < row.hi; tx += 38){
    var nearX = NS.some(function(n){ return Math.abs(tx - n.x) < 15; });
    if (nearX) continue;
    if (Math.random() < 0.75) treePts.push([tx + Math.random() * 6, row.z - 13.5]);
    if (Math.random() < 0.75) treePts.push([tx + Math.random() * 6, row.z + 13.5]);
  }
});

// distant skyline filler ring
(function(){
  for (var k = 0; k < 55; k++){
    var a = Math.random() * Math.PI * 2;
    var rr = 720 + Math.random() * 380;
    var x = -60 + Math.cos(a) * rr, z = 120 + Math.sin(a) * rr * 0.85;
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
XINGS.forEach(function(xg){
  lampPts.push([xg.n.x + 13, xg.e.z + 13]); lampPts.push([xg.n.x - 13, xg.e.z - 13]);
});
[{z: 0, lo: X0 + 60, hi: X1 - 30}, {z: 100, lo: X0 + 60, hi: X1 - 30},
 {z: 400, lo: 160, hi: X1 - 30}].forEach(function(mb){ // midblock Main/Vine/Euclid
  for (var x = mb.lo; x < mb.hi; x += 66) lampPts.push([x, mb.z + 11.5]);
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
  var poles = new THREE.InstancedMesh(poleG, poleM, XINGS.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  var k = 0;
  var ballG = new THREE.SphereGeometry(0.45, 8, 8);
  XINGS.forEach(function(xg){
    var px = xg.n.x - 12.4, pz = xg.e.z + 12.4;
    M.compose(new THREE.Vector3(px, 3, pz), q, one); poles.setMatrixAt(k++, M);
    var a = new THREE.Mesh(ballG, sigEWMat); a.position.set(px, 5.6, pz); scene.add(a);
    var b = new THREE.Mesh(ballG, sigNSMat); b.position.set(px, 4.5, pz); scene.add(b);
  });
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
  var poles = new THREE.InstancedMesh(poleG, signGreenMat, XINGS.length);
  var M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  var k = 0;
  XINGS.forEach(function(xg){
    var px = xg.n.x + 12.6, pz = xg.e.z - 12.6;
    M.compose(new THREE.Vector3(px, 2.3, pz), q, one);
    poles.setMatrixAt(k++, M);
    var texA = new THREE.MeshStandardMaterial({map: streetSignTex(xg.e.name), roughness: 0.55});
    var a = new THREE.Mesh(bladeG, [signGreenMat, signGreenMat, signGreenMat, signGreenMat, texA, texA]);
    a.position.set(px, 4.3, pz); scene.add(a);         // EW blade reads N/S
    var texB = new THREE.MeshStandardMaterial({map: streetSignTex(xg.n.name), roughness: 0.55});
    var b = new THREE.Mesh(bladeG, [signGreenMat, signGreenMat, signGreenMat, signGreenMat, texB, texB]);
    b.position.set(px, 3.8, pz); b.rotation.y = Math.PI / 2; scene.add(b);
  });
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

var lanes = [];   // {axis, along-street coord fixed, dir, lo, hi, crosses, cars: []}
EW.forEach(function(s){
  var lo = ewLo(s), hi = ewHi(s);
  var crosses = NS.filter(function(n){ return meets(s, n); }).map(function(n){ return n.x; });
  s.dirs.forEach(function(d, di){
    if (s.dirs.length === 1) { lanes.push({axis: 'x', c: s.z - 3.6, dir: d, lo: lo, hi: hi, crosses: crosses, cars: []});
                               lanes.push({axis: 'x', c: s.z + 3.6, dir: d, lo: lo, hi: hi, crosses: crosses, cars: []}); }
    else lanes.push({axis: 'x', c: s.z + d * 3.6, dir: d, lo: lo, hi: hi, crosses: crosses, cars: []});
  });
});
NS.forEach(function(s){
  var lo = nsLo(s), hi = nsHi(s);
  var crosses = EW.filter(function(e){ return meets(e, s); }).map(function(e){ return e.z; });
  if (s.dirs.length === 1){
    lanes.push({axis: 'z', c: s.x - 3.6, dir: s.dirs[0], lo: lo, hi: hi, crosses: crosses, cars: []});
    lanes.push({axis: 'z', c: s.x + 3.6, dir: s.dirs[0], lo: lo, hi: hi, crosses: crosses, cars: []});
  } else s.dirs.forEach(function(d){
    lanes.push({axis: 'z', c: s.x - d * 3.6, dir: d, lo: lo, hi: hi, crosses: crosses, cars: []});
  });
});

var cars = [];
lanes.forEach(function(L){
  var lo = L.lo, hi = L.hi;
  var count = Math.max(2, Math.min(4, Math.round((hi - lo) / 300)));
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
               v: 0, vt: 10 + Math.random() * 4, id: 'CAR-' + ('0' + (cars.length + 1)).slice(-2)};
    L.cars.push(car); cars.push(car);
    vehicles.push({g: g, ai: car, th: g.rotation.y, spd: 0});
  }
});
function placeCar(c){
  if (c.lane.axis === 'x') c.g.position.set(c.s, 0.15, c.lane.c);
  else c.g.position.set(c.lane.c, 0.15, c.s);
}
cars.forEach(placeCar);

var CYCLE = 26;
function ewGreen(t){ return (t % CYCLE) < 11; }
function nsGreen(t){ var p = t % CYCLE; return p >= 13 && p < 24; }

function updateCars(dt, tNow){
  var green = {x: ewGreen(tNow), z: nsGreen(tNow)};
  lanes.forEach(function(L){
    var lo = L.lo, hi = L.hi;
    var crosses = L.crosses;
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
      if (c.s > hi) c.s = lo;
      if (c.s < lo) c.s = hi;
      placeCar(c);
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
EW.forEach(function(s){
  if (s.belt) return;   // no sidewalks on the New Circle beltline
  pedStreets.push({axis: 'x', c: s.z, lo: Math.max(ewLo(s) + 40, -230), hi: ewHi(s) - 40});
});
NS.forEach(function(s){
  // sidewalks stop at the USB — nobody window-shops on Paris Pike (or the beltline)
  if (s.belt) return;
  pedStreets.push({axis: 'z', c: s.x, lo: Math.max(nsLo(s) + 40, -920), hi: nsHi(s) - 40});
});
for (var pk = 0; pk < 64; pk++){
  var st = pedStreets[(Math.random() * pedStreets.length) | 0];
  var side = Math.random() < 0.5 ? -11 : 11;
  var g = new THREE.Group();
  var body = new THREE.Mesh(pedBodyG, PED_COLS[(Math.random() * PED_COLS.length) | 0]);
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  var head = new THREE.Mesh(pedHeadG, skinMat); head.position.y = 1.55; g.add(head);
  scene.add(g);
  var lo = st.lo, hi = st.hi;
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
  var av = {g: g, torso: torso,   // torso material kept as a recolor handle (F2 color persist)
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
// private-room code (F4): #room=<code> routes you to an isolated world. Empty = PUBLIC.
function cleanRoom(s){ return (s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12).toUpperCase(); }
var roomM = /(?:^|[#&])room=([^&#]+)/.exec(hashStr);
var roomCode = '';
if (roomM){
  try { roomCode = cleanRoom(decodeURIComponent(roomM[1])); }
  catch (e){ roomCode = cleanRoom(roomM[1]); }   // malformed % escapes: use the raw match
}
var myColorIdx = (Math.random() * PLAYER_COLS.length) | 0;
try {
  var _sc = localStorage.getItem('lt_color');
  if (_sc !== null){ var _ci = parseInt(_sc, 10); if (_ci >= 0 && _ci < PLAYER_COLS.length) myColorIdx = _ci; }
  else localStorage.setItem('lt_color', String(myColorIdx));   // lock the first random pick in - THE stranger-bug fix
} catch (e){}
var myColor = PLAYER_COLS[myColorIdx];
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
              heli: false, ride: null, bus: null, scoot: null, kx: 0, kz: 0,
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
  if (on && (player.ride || player.bus !== null || player.scoot)) return;   // a passenger / scooter rider is never a valid tag target
  if (on && blasterMissionActive()) return;   // mission darts never opt you in
  if (player.pvp === on) return;
  player.pvp = on;
  player.av.gun.visible = on;
  syncBtns();
}
var _aim = new THREE.Vector3();
function fireDart(){
  if (mode !== 'player' || player.veh || player.ride || player.bus !== null || player.scoot || isFrozen()) return;
  // first press draws = opts in — EXCEPT during a blaster mission, where the
  // dart is a tool and firing it must not make you a freeze-tag target
  if (!player.pvp && !blasterMissionActive()){ setPvp(true); return; }
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
  // only opted-in shots relay — the server drops pvp=0 shots anyway, and
  // mission darts (fired un-opted via the blasterMissionActive fall-through)
  // are purely local
  if (online && ws && ws.readyState === 1 && player.pvp)
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
    // mission 8: my darts settle loose foals (client-local — other players'
    // darts are cosmetic and never touch my foals)
    if (!dead && d.mine && mission8.stage === 'wrangle'){
      for (var fi = 0; fi < m8Foals.length; fi++){
        var f = m8Foals[fi];
        if (f.state !== 'loose' && f.state !== 'bolt') continue;
        var fp = f.g.position;
        var fdx = p.x - fp.x, fdy = p.y - (fp.y + 0.9), fdz = p.z - fp.z;
        if (fdx * fdx + fdz * fdz < 6.25 && fdy * fdy < 4){
          dead = true;
          settleFoal(f);
          break;
        }
      }
    }
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
    if (!player.heli && !player.veh && !player.ride && player.bus === null && !player.scoot && mode === 'player'){
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
var AC = null, sndMaster = null, rotorGain = null, noiseBuf = null, rainGain = null;
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
    // rain hiss (F3): bandpassed noise loop, gain-steered by wxRain in updateAssetAudio
    rainGain = AC.createGain(); rainGain.gain.value = 0; rainGain.connect(sndMaster);
    var rns = AC.createBufferSource(); rns.buffer = noiseBuf; rns.loop = true;
    var rbp = AC.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 1200; rbp.Q.value = 0.7;
    rns.connect(rbp); rbp.connect(rainGain);
    rn.start(); lfo.start(); hum.start(); rns.start();
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

// ---------- asset audio (generated suite: web/audio/*.mp3) ----------
// MP3s baked offline by tools/gen-audio.mjs (ElevenLabs); the client only
// fetches static files, lazily, on first use. Everything routes through
// assetGain -> sndMaster so the SND toggle mutes the whole suite. The synth
// SFX above stay authoritative for combat/heli; this layer adds the radio,
// mission stingers, dispatch VO, and world ambience.
var assetGain = null, radioGain = null;
var clips = {};   // key -> {buf, cbs}
function assetAudioInit(){
  if (assetGain || !AC) return;
  assetGain = AC.createGain(); assetGain.gain.value = 1; assetGain.connect(sndMaster);
  radioGain = AC.createGain(); radioGain.gain.value = 0.5; radioGain.connect(assetGain);
}
function loadClip(key, cb){
  var c = clips[key];
  if (c && c.buf){ if (cb) cb(c.buf); return; }
  if (c){ if (cb) c.cbs.push(cb); return; }
  c = clips[key] = {buf: null, cbs: cb ? [cb] : []};
  fetch('audio/' + key + '.mp3').then(function(r){
    if (!r.ok) throw new Error('http ' + r.status);
    return r.arrayBuffer();
  }).then(function(ab){
    return new Promise(function(res, rej){ AC.decodeAudioData(ab, res, rej); });
  }).then(function(buf){
    c.buf = buf;
    var cbs = c.cbs; c.cbs = [];
    for (var i = 0; i < cbs.length; i++) cbs[i](buf);
  }).catch(function(){ delete clips[key]; });   // missing asset = silent no-op
}
function playClip(key, opts){
  if (!AC || !sndOn) return null;
  assetAudioInit();
  opts = opts || {};
  var h = {src: null, stopped: false, g: AC.createGain()};
  h.g.gain.value = opts.gain !== undefined ? opts.gain : 0.8;
  h.g.connect(opts.out || assetGain);
  h.stop = function(){
    h.stopped = true;
    if (h.src){ try { h.src.onended = null; h.src.stop(); } catch (e){} }
    try { h.g.disconnect(); } catch (e){}
  };
  loadClip(key, function(buf){
    if (h.stopped) return;
    var s = AC.createBufferSource();
    s.buffer = buf; s.loop = !!opts.loop;
    if (opts.rate) s.playbackRate.value = opts.rate;
    s.connect(h.g);
    if (opts.onended) s.onended = opts.onended;
    var off = opts.offsetFrac ? buf.duration * opts.offsetFrac : 0;
    if (off > buf.duration - 2) off = 0;
    s.start(AC.currentTime, off);
    h.src = s;
  });
  return h;
}
// looping ambience beds: created at gain 0 on first demand, then steered.
// tc is the setTargetAtTime time constant — ambience wants a slow fade
// (default 0.5s), the jetpack wants a snappy one.
var ambLoops = {};
function ambSet(key, target, rate, tc){
  var L = ambLoops[key];
  if (!L){
    if (target < 0.02) return;
    var h = playClip(key, {gain: 0, loop: true, rate: rate});
    if (!h) return;   // muted or no AC yet — retried next tick
    L = ambLoops[key] = {h: h};
  }
  L.h.g.gain.setTargetAtTime(target, AC.currentTime, tc || 0.5);
}

// --- car radio ---
var RADIO_STATIONS = [
  {name: 'RADIO OFF'},
  {name: 'BIG BLUE RADIO 100.1 FM',
   music: ['radio_bg_1', 'radio_bg_2', 'radio_bg_3'],
   breaks: ['radio_id_1', 'radio_id_2', 'ad_als', 'ad_cars', 'ad_park', 'ad_psa']},
  {name: 'NEWS 630 THE BLOCK',
   talk: ['news_id', 'news_1', 'news_wx', 'news_2', 'news_traffic', 'news_caller',
          'ad_psa', 'ad_park', 'ad_als']},
  {name: '98.5 THE CAT — UK SPORTS',
   talk: ['sp_id', 'sp_jingle', 'sp_bball', 'sp_fb', 'sp_caller', 'sp_ad', 'ad_als']},
  {name: 'TRACKSIDE 1450 AM',
   talk: ['tr_id', 'tr_bugle', 'tr_race', 'tr_tips', 'ad_park', 'ad_cars']}
];
var radio = {st: 1, cur: null, last: '', lastKind: '', token: 0, queue: [], bags: {}};
try { radio.st = Math.min(RADIO_STATIONS.length - 1, Math.max(0, parseInt(localStorage.getItem('lt_radio') || '1', 10) || 0)); } catch (e){}
function inCar(){ return !!player.veh || !!player.ride || player.bus !== null; }   // driving, riding shotgun, OR on the bus (it has a radio)
function radioActive(){ return radio.st > 0 && mode === 'player' && inCar(); }
// fixed shuffled rotation per station+pool: a segment cannot air again until
// every other segment in its pool has aired once. Shuffled per session, then
// looped — a plain reshuffled bag can still repeat across the reshuffle seam.
function radioDraw(kind, pool){
  var k = radio.st + ':' + kind, rot = radio.bags[k];
  if (!rot){
    var order = pool.slice();
    for (var i = order.length - 1; i > 0; i--){
      var j = (Math.random() * (i + 1)) | 0, t = order[i]; order[i] = order[j]; order[j] = t;
    }
    rot = radio.bags[k] = {order: order, i: 0};
  }
  var key = rot.order[rot.i];
  rot.i = (rot.i + 1) % rot.order.length;
  return key;
}
function radioPick(){
  var st = RADIO_STATIONS[radio.st], kind;
  if (st.music){
    kind = radio.lastKind === 'music' && Math.random() < 0.45 ? 'break' : 'music';
  } else {
    kind = 'talk';
  }
  radio.lastKind = kind;
  var key = radioDraw(kind, kind === 'break' ? st.breaks : (kind === 'music' ? st.music : st.talk));
  radio.last = key;
  return key;
}
function radioStop(){
  radio.token++;
  if (radio.cur) radio.cur.stop();
  radio.cur = null;
}
function radioNext(tuneIn){
  radioStop();
  if (!radioActive()) return;
  var tok = radio.token;
  // queued interrupts (emergency alerts) preempt regular programming on
  // every station
  var fromQueue = radio.queue.length > 0;
  var key = fromQueue ? radio.queue.shift() : radioPick();
  radio.cur = playClip(key, {
    gain: 1, out: radioGain,
    // tuning into a music station mid-song sells the "it was already on" feel
    offsetFrac: tuneIn && !fromQueue && radio.lastKind === 'music' ? Math.random() * 0.7 : 0,
    onended: function(){ if (tok === radio.token) radioNext(false); }
  });
  if (!radio.cur) radioStop();
}
function cycleRadio(){
  if (!inCar() || mode !== 'player') return;
  pokeAudio(); assetAudioInit();
  radio.st = (radio.st + 1) % RADIO_STATIONS.length;
  try { localStorage.setItem('lt_radio', String(radio.st)); } catch (e){}
  playClip('sfx_static', {gain: 0.4});
  caption('RADIO', RADIO_STATIONS[radio.st].name, 1800);
  if (radio.st > 0) radioNext(true);
  else radioStop();
  updateRadioChip();
  syncBtns();
}
// now-playing chip: prominent, tappable radio control shown while driving
var _radioChipTxt = '';
function updateRadioChip(){
  var el = document.getElementById('radiochip');
  if (!el) return;
  var show = mode === 'player' && inCar();
  var txt = show ? RADIO_STATIONS[radio.st].name : '';
  if (txt === _radioChipTxt) return;
  _radioChipTxt = txt;
  el.style.display = show ? 'block' : 'none';
  if (show) document.getElementById('radiosta').textContent = txt;
}

// --- world/mission audio watcher, ticked from frame() ---
var PARK_PTS = [[-171, 40], [122, 50], [250, 50], [350, 300], [150, -535], [150, -874]];
var BELL_PT = {x: -46, z: -262};   // First Presbyterian tower
var aw = {m1: '', m2: '', m3: '', m4: '', m5: '', m6: '', m7: '', hFloor: -1, horse: [], acc: 0};
function stinger(stage, prev){
  if (stage === prev) return stage;
  if (prev !== ''){   // skip the very first observation (page load)
    if (stage === 'intro' || stage === 'brief' || stage === 'driving' ||
        stage === 'drive' || stage === 'tag') playClip('st_start', {gain: 0.7});
    else if (stage === 'won') playClip('st_win', {gain: 0.8});
    else if (stage === 'fail') playClip('st_fail', {gain: 0.8});
  }
  return stage;
}
function updateAssetAudio(dt){
  updateRadioChip();   // cheap (text-guarded); tracks vehicle enter/exit + mode
  if (!AC) return;
  assetAudioInit();
  if (rainGain) rainGain.gain.setTargetAtTime(wxRain * 0.35, AC.currentTime, 0.5);   // rain hiss steer (F3)
  // mission stingers on stage transitions (one watcher, no per-mission hooks)
  var prevM2 = aw.m2;
  aw.m1 = stinger(mission.stage, aw.m1);
  aw.m2 = stinger(mission2.stage, aw.m2);
  aw.m3 = stinger(mission3.stage, aw.m3);
  aw.m4 = stinger(mission4.stage, aw.m4);
  aw.m5 = stinger(mission5.stage, aw.m5);
  aw.m6 = stinger(mission6.stage, aw.m6);
  aw.m7 = stinger(mission7.stage, aw.m7);
  // SNOW EMERGENCY: queue an EAS interrupt — it airs the moment the player
  // hops in the plow (the radio auto-starts and plays the queue first)
  if (aw.m2 === 'brief' && prevM2 !== 'brief' && prevM2 !== ''){
    radio.queue = ['alert_tone', 'alert_snow'];
    if (radioActive()) radioNext(false);   // already driving? cut in now
  }
  if (radio.queue.length && aw.m2 !== 'brief' && aw.m2 !== 'plow') radio.queue = [];
  // jetpack thrust loop — yours at full gain, nearby fliers quieter
  var jet = player.thrusting ? 0.5 : 0;
  for (var ri in remotes){
    var rr = remotes[ri];
    if (rr.m !== 1) continue;
    var rd = Math.hypot(rr.av.g.position.x - player.x, rr.av.g.position.z - player.z);
    if (rd < 60) jet = Math.max(jet, (1 - rd / 60) * 0.25);
  }
  ambSet('sfx_jet', jet, 1, 0.08);
  // horses: whinny on bolt, gallop bed while one is bolting / being ridden
  var gallop = 0, gallopRate = 1;
  for (var i = 0; i < m4Horses.length; i++){
    var h = m4Horses[i];
    var hd = Math.hypot(h.g.position.x - player.x, h.g.position.z - player.z);
    if (h.state === 'bolt' && aw.horse[i] !== 'bolt' && hd < 150)
      playClip('sfx_whinny', {gain: Math.max(0.15, 1 - hd / 150) * 0.8});
    aw.horse[i] = h.state;
    if (h.state === 'bolt') gallop = Math.max(gallop, (1 - Math.min(1, hd / 120)) * 0.6);
    if (h.state === 'riding' || h.state === 'trot'){ gallop = Math.max(gallop, 0.5); gallopRate = 1.08; }
  }
  // slow ticks: ambience beds + bells
  aw.acc += dt;
  if (aw.acc < 0.25) return;
  aw.acc = 0;
  ambSet('sfx_gallop', gallop, gallopRate);
  var night = envAt(simH).night;
  var pd = 1e9;
  for (var k = 0; k < PARK_PTS.length; k++){
    var dpk = Math.hypot(PARK_PTS[k][0] - player.x, PARK_PTS[k][1] - player.z);
    if (dpk < pd) pd = dpk;
  }
  ambSet('amb_birds', Math.max(0, 1 - pd / 160) * 0.45 * (1 - night));
  var dc = Math.hypot(player.x, player.z);
  ambSet('amb_hum', Math.max(0, 1 - dc / 500) * (0.22 - night * 0.08));
  ambSet('amb_wind', m2Sky * 0.55);
  // church bells at 06:00 / 12:00 / 18:00 sim time, if within earshot
  var hf = Math.floor(simH);
  if (hf !== aw.hFloor){
    var first = aw.hFloor === -1;
    aw.hFloor = hf;
    if (!first && hf > 0 && hf % 6 === 0){
      var bd = Math.hypot(BELL_PT.x - player.x, BELL_PT.z - player.z);
      if (bd < 420) playClip('amb_bells', {gain: Math.max(0.08, 1 - bd / 420) * 0.7});
    }
  }
  // radio resumes if a clip failed to start (e.g. tuned while muted)
  if (radioActive() && !radio.cur) radioNext(true);
  if (!radioActive() && radio.cur) radioStop();
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
  // reading time scales with length: ~14 chars/sec + a beat to notice.
  // (BBC / Game Accessibility Guidelines: 160-180 wpm ≈ 15-17 cps is
  // comfortable for film; all-caps read mid-gameplay is slower.) A passed
  // dur acts as a minimum — computed time can extend it, never shorten it.
  var need = Math.min(9000, Math.max(2600, 1400 + text.length * 70));
  capUntil = performance.now() + Math.max(dur || 0, need);
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
// leaderboards are PUBLIC-only: a private room keeps its times off the boards
// (the server also drops them, but gating here saves the round-trip). Device
// bests still persist locally.
function sendScore(obj){
  if (roomCode) return;
  if (online && ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function submitScore(ms){
  try {
    if (!missionBest || ms < missionBest){
      missionBest = ms;
      localStorage.setItem('lt_mission_best', String(Math.round(ms)));
    }
  } catch (e){}
  sendScore({t: 'score', ms: Math.round(ms)});
}
// mission-funnel telemetry (F5): fire-and-forget event beacons keyed by number
// (enum space 10-19 = mission 4). Not routed through sendScore - mev is fine
// from any room; the server logs which room it came from.
function mev(k){
  if (online && ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'mev', k: k}));
}
function fmtMs(ms){ return (ms / 1000).toFixed(1) + 's'; }
function missionPoints(ms){ return Math.max(100, 1000 - Math.round(ms / 100)); }
// DAILY DASH modal meta: 'NEW ROUTE IN xH yM' countdown to the next EST day
// boundary (same anchor as dayIndex()) + this device's best time for today.
// Computed locally so it shows offline too; dayIndex/dailyBest live on the
// missionD island and resolve at call time (runtime), well after load.
function dailyCountdown(){
  var next = (dayIndex() + 1) * 86400e3 + 5 * 3600e3;   // ms at the next EST midnight boundary
  var rem = Math.max(0, next - Date.now());
  var h = Math.floor(rem / 3600e3), mn = Math.floor((rem % 3600e3) / 60e3);
  return 'NEW ROUTE IN ' + h + 'H ' + mn + 'M';
}
function setDailyMeta(){
  var el = document.getElementById('scoreDailyMeta');
  if (!el) return;
  var best = (dailyBest && dailyBest.day === dayIndex()) ? 'YOUR BEST TODAY ' + fmtMs(dailyBest.ms) : 'NO RUN TODAY YET';
  el.textContent = dailyCountdown() + ' · ' + best;
}
function showScores(myMs, board){
  var sEl = document.getElementById('scores');
  if (!sEl) return;
  sEl.hidden = false;
  // free the cursor so the modal is clickable from mouse-look
  if (document.exitPointerLock) document.exitPointerLock();
  var you;
  if (myMs){
    var verb = board === 2 ? 'PLOWED IN ' : board === 3 ? 'STORY BROKEN IN ' :
               board === 4 ? 'HORSES HOME IN ' : board === 5 ? 'DEADLINE MET IN ' :
               board === 6 ? 'SCOOPS LANDED IN ' : board === 7 ? 'LOT TAGGED IN ' :
               board === 8 ? 'FOALS PENNED IN ' : board === 9 ? 'ROUTE FLOWN IN ' :
               board === 10 ? 'THE DASH IN ' : 'CHOPPER DOWN IN ';
    you = verb + fmtMs(myMs) + ' · +' + missionPoints(myMs) + ' PTS';
    var best = board === 2 ? m2Best : board === 3 ? m3Best : board === 4 ? m4Best :
               board === 5 ? m5Best : board === 6 ? m6Best : board === 7 ? m7Best :
               board === 8 ? m8Best : board === 9 ? m9Best :
               board === 10 ? (dailyBest ? dailyBest.ms : 0) : missionBest;
    if (best) you += ' · DEVICE BEST ' + fmtMs(best);
    if (roomCode) you += ' · PRIVATE ROOM · TIMES DON\'T RANK';
  } else {
    you = (missionBest ? 'RIBBON: ' + fmtMs(missionBest) : 'RIBBON: —') +
      ' · ' + (m2Best ? 'SNOW: ' + fmtMs(m2Best) : 'SNOW: —') +
      ' · ' + (m3Best ? 'DATA CENTER: ' + fmtMs(m3Best) : 'DATA CENTER: —') +
      ' · ' + (m4Best ? 'HORSEPOWER: ' + fmtMs(m4Best) : 'HORSEPOWER: —') +
      ' · ' + (m5Best ? 'DEADLINE: ' + fmtMs(m5Best) : 'DEADLINE: —') +
      ' · ' + (m6Best ? 'MELT: ' + fmtMs(m6Best) : 'MELT: —') +
      ' · ' + (m7Best ? 'TAILGATE: ' + fmtMs(m7Best) : 'TAILGATE: —') +
      ' · ' + (m8Best ? 'PADDOCK: ' + fmtMs(m8Best) : 'PADDOCK: —') +
      ' · ' + (m9Best ? 'AIR MAIL: ' + fmtMs(m9Best) : 'AIR MAIL: —');
  }
  document.getElementById('scoreYou').textContent = you;
  setDailyMeta();
  ['scoreListD', 'scoreList', 'scoreList2', 'scoreList3', 'scoreList4', 'scoreList5', 'scoreList6', 'scoreList7', 'scoreList8', 'scoreList9'].forEach(function(id){
    var list = document.getElementById(id);
    if (!list) return;
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
  fill('scoreListD', m.d || []);
  fill('scoreList', m.m1 || m.top || []);
  fill('scoreList2', m.m2 || []);
  fill('scoreList3', m.m3 || []);
  fill('scoreList4', m.m4 || []);
  fill('scoreList5', m.m5 || []);
  fill('scoreList6', m.m6 || []);
  fill('scoreList7', m.m7 || []);
  fill('scoreList8', m.m8 || []);
  fill('scoreList9', m.m9 || []);
  setDailyMeta();   // refresh the countdown + device best when server times land
}
function updateMission(dt){
  var now = performance.now();
  if (capEl && !capEl.hidden && now > capUntil) capEl.hidden = true;
  if (setPieces.trig){
    setPieces.trig.rotation.z += dt * 0.8;
    setPieces.trig.visible = allIdle();
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
    if (t > 5.4 && mission.capIdx === 0){ mission.capIdx = 1; caption('THE MAYOR', 'THANK YOU ALL. TODAY WE HONOR... A HORSE.'); }
    if (t > 9.8 && mission.capIdx === 1){ mission.capIdx = 2; caption('THE MAYOR', 'POSSIBLY SEVERAL HORSES. THE PLAQUE IS AMBIGUOUS.'); }
    if (t > 14.6 && mission.capIdx === 2){ mission.capIdx = 3; caption('ANNOUNCER', 'IS THAT... THE NEWS CHOPPER?'); }
    if (t > 18.2){
      mission.stage = 'fight'; mission.tStage = 0; mission.capAt = 8;
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
    if (t > 7.2 && mission.capIdx === 9){
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
var snowPts = null, m2Sky = 0;
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
// generalized precipitation rig - snow and rain are two instances of one system.
// Box 260x260, height 0..90, camera-locked and wrapping. Built hidden.
function makePrecip(opts){
  var N = opts.count;
  var geo = new THREE.BufferGeometry();
  var pos = new Float32Array(N * 3);
  for (var i = 0; i < N; i++){
    pos[i * 3] = (Math.random() - 0.5) * 260;
    pos[i * 3 + 1] = Math.random() * 90;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 260;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var p = new THREE.Points(geo, new THREE.PointsMaterial({
    color: opts.color, size: opts.size, transparent: true, opacity: opts.opacity, sizeAttenuation: true}));
  p.visible = false;
  p.userData = {fall: opts.fall, drift: opts.drift};
  scene.add(p);
  return p;
}
function updatePrecip(p, dt){
  if (!p || !p.visible) return;
  var pos = p.geometry.attributes.position.array;
  var t = performance.now() * 0.001;
  var fall = p.userData.fall, drift = p.userData.drift;
  for (var i = 0; i < pos.length; i += 3){
    pos[i + 1] -= (fall + (i % 7) * 0.7) * dt;   // base fall + per-index variation
    if (drift) pos[i] += Math.sin(t + i) * dt * drift;   // sin skipped when drift is 0
    if (pos[i + 1] < 0) pos[i + 1] = 90;
  }
  p.geometry.attributes.position.needsUpdate = true;
  p.position.set(camera.position.x, 0, camera.position.z);
}
// snow (mission-2 storm) - thin wrappers with the EXACT prior constants so
// SNOW EMERGENCY renders identically: fall 4.55 = 6.5*0.7, drift 1.2, i%7 shape.
function ensureSnowPts(){
  if (!snowPts){ snowPts = makePrecip({count: 1300, color: 0xffffff, size: 0.55, opacity: 0.85, fall: 4.55, drift: 1.2}); }
  snowPts.visible = true;
}
function updateSnowPts(dt){ updatePrecip(snowPts, dt); }
// ---------- ambient weather (F3): deterministic, wall-clock scheduled ----------
// Weather is a pure function of Date.now(), so every client with a roughly
// correct clock paints the same sky for the same real minute - no relay, no
// server field, works offline. The mission-2 snowstorm (m2Sky) always wins:
// ambient scalars fade to 0 whenever the storm is up, so snow and rain are
// never on screen together. Runs on real wall-clock time, decoupled from simH.
var rainP = null;
function ensureRain(){
  if (!rainP) rainP = makePrecip({count: IS_COARSE ? 500 : 1300, color: 0xbcd4ff,
    size: 0.35, opacity: 0.6, fall: 22, drift: IS_COARSE ? 0 : 0.35});
  return rainP;
}
var PERIOD_MS = 480000;   // ~8 min real-time weather periods
// mulberry32-style integer hash - bit-identical across engines (the shared-world promise)
function wxRand(s){ s = (s + 0x6D2B79F5) | 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
function wxAt(period){
  var r = wxRand(period), st;
  if (r < 0.60) st = 'clear'; else if (r < 0.80) st = 'rain'; else if (r < 0.92) st = 'fog'; else st = 'overcast';
  return { state: st, intensity: 0.4 + wxRand(period ^ 0x9e3779b9) * 0.6 };
}
// preference + overrides
var wxEnabled = true;
try { if (localStorage.getItem('lt_wx') === '0') wxEnabled = false; } catch (e){}
var wxPin = null;   // #wx=<state> pins one state; #wx=off disables weather
(function(){
  var m = /wx=([a-z]+)/.exec(hashStr);
  if (!m) return;
  var v = m[1];
  if (v === 'off') wxEnabled = false;
  else if (v === 'clear' || v === 'rain' || v === 'fog' || v === 'overcast') wxPin = v;
})();
var wxOverride = null;   // set by __lt.wx(state, intensity) for scripted capture
// blend scalars, eased ~25s toward target; color scratch for the grey/blue tint
var wxRain = 0, wxFog = 0, wxGrey = 0, wxSun = 1, wxFlash = 0;
var _wxGreyC = new THREE.Color(0x9aa3ad), _wxRainC = new THREE.Color(0x8393a8), _wxCol = new THREE.Color(0x9aa3ad);
var wxCurState = 'clear', wxCurIntensity = 0, _nextThunder = 0, _wxWord = '';
function updateWeather(dt){
  // resolve this tick's target (mission storm and the off switch force clear)
  var tgt;
  if (m2Sky > 0.01 || !wxEnabled) tgt = {state: 'clear', intensity: 0};
  else if (wxOverride) tgt = wxOverride;
  else if (wxPin) tgt = {state: wxPin, intensity: 0.85};
  else if (CINE) tgt = {state: 'clear', intensity: 0};   // no random rain in a trailer take
  else tgt = wxAt(Math.floor(Date.now() / PERIOD_MS));
  wxCurState = tgt.state; wxCurIntensity = tgt.intensity;
  var i = tgt.intensity, tR = 0, tF = 0, tG = 0, tSun = 1, bluish = 0;
  if (tgt.state === 'rain'){ tR = i; tF = 0.4; tG = 0.55; tSun = 1 - 0.55 * i; bluish = 1; }
  else if (tgt.state === 'fog'){ tF = 1; tG = 0.7; tSun = 1 - 0.3; }
  else if (tgt.state === 'overcast'){ tF = 0.25; tG = 0.6; tSun = 1 - 0.4; }
  var k = Math.min(1, dt * 0.15);   // ~25s settle, same easing shape as m2Sky
  wxRain += (tR - wxRain) * k;
  wxFog += (tF - wxFog) * k;
  wxGrey += (tG - wxGrey) * k;
  wxSun += (tSun - wxSun) * k;
  // sky/fog tint: grey, drifting toward a cool blue while it's actually raining
  _wxCol.copy(_wxGreyC);
  if (bluish) _wxCol.lerp(_wxRainC, wxRain);
  // rain particles (camera-locked); opacity + visibility track intensity
  ensureRain();
  rainP.material.opacity = 0.6 * wxRain;
  rainP.visible = wxRain > 0.01;
  updatePrecip(rainP, dt);
  // thunder: only in heavy rain - a low noise rumble + a one-frame sun flash
  if (wxCurState === 'rain' && wxRain > 0.7){
    if (_nextThunder === 0) _nextThunder = performance.now() + 20000 + Math.random() * 40000;
    else if (performance.now() > _nextThunder){
      sndNoise(0.8, 400, 60, 0.5);
      wxFlash = 1;
      _nextThunder = performance.now() + 20000 + Math.random() * 40000;
    }
  } else _nextThunder = 0;
  if (wxFlash > 0.01) wxFlash -= dt * 4; else wxFlash = 0;
}

// ---------- RIDE THE BUS (F1) ----------
// A LexTran loop bus whose position is a pure function of wall-clock time — the
// same determinism trick as the weather above. Every client computes
// busStateAt(Date.now()), so the bus is bit-identical everywhere (private rooms
// included) and survives a reload mid-route, with ZERO new network protocol. It
// runs a legal downtown loop (Main St E → MLK S → Vine St W → Broadway N) in the
// correct lane offset, dwells 14s with the doors open at four stops, and you ride
// it by standing at a stop and pressing E (it rides the m:4 passenger channel).
var BUS_SPEED = 8.5;      // m/s along the route polyline (under the server h:38 cap)
var BUS_DWELL = 14000;    // ms stopped, doors open, at each stop
var BUS_LANE = 3.6;       // lane offset from centerline — matches ambient traffic
var BUS_FLOOR = 0.95;     // seated-avatar foot height above the road inside the bus
var BUS_CURB = 4.6;       // lateral hop-out distance (drops you onto the sidewalk)
// Stops in route order. sx/sz is where the bus halts (on the travel lane); th is
// the road heading there. The board/shelter/curb points all sit on the +lateral
// (curb) side, which is the correct kerb for both legs given the one-way tables.
var BUS_STOPS = [
  {name: 'VICTORIAN SQUARE', sx: -155, sz: BUS_LANE, th: 0},        // Main St, just east of Broadway
  {name: 'PHOENIX PARK',     sx: 80,  sz: BUS_LANE, th: 0},        // Main St, just west of Limestone
  {name: 'LIBRARY',          sx: 178, sz: 100 - BUS_LANE, th: Math.PI},  // Vine St WB, MLK/Rose end
  {name: 'TRANSIT CENTER',   sx: -85, sz: 100 - BUS_LANE, th: Math.PI}   // Vine St WB, near Mill (real hub: 220 W Vine)
];
BUS_STOPS.forEach(function(s){
  var lx = Math.sin(s.th), lz = Math.cos(s.th);   // +lateral unit = curb side
  s.bx = s.sx + lx * 3.4; s.bz = s.sz + lz * 3.4;   // board point (bus door → curb gap)
  s.shx = s.sx + lx * 6.4; s.shz = s.sz + lz * 6.4;  // shelter point, on the sidewalk
  s.cbx = lx * BUS_CURB; s.cbz = lz * BUS_CURB;      // hop-out curb vector
});
// Seat grid inside the bus (bus-local: +lf forward along heading, +ll lateral).
var BUS_SEATS = [
  {lf: 3.0, ll: -0.8}, {lf: 3.0, ll: 0.8},
  {lf: 0.6, ll: -0.8}, {lf: 0.6, ll: 0.8},
  {lf: -1.8, ll: -0.8}, {lf: -1.8, ll: 0.8}
];
function busSeatFor(id){   // stable seat index from a player id (remote seat snap)
  var h = 0, i; id = '' + id;
  for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % BUS_SEATS.length;
}
function busSeatWorld(bs, idx){
  var s = BUS_SEATS[idx % BUS_SEATS.length];
  var c = Math.cos(bs.th), sn = Math.sin(bs.th);
  var x = bs.x + s.lf * c + s.ll * sn;
  var z = bs.z - s.lf * sn + s.ll * c;
  return {x: x, y: groundY(x, z) + BUS_FLOOR, z: z, ry: bs.th};
}
// Piecewise timeline built once at boot: move segments (constant BUS_SPEED along
// the polyline) alternating with 14s dwells at the stops. Corners are rounded
// with a short quadratic-Bézier arc (3 interpolated points) so the bus swings the
// turn instead of pivoting; heading falls out of each short segment's direction.
var busPhases = [], BUS_PERIOD = 0, busStopArrive = [];
(function(){
  var R = 7;
  function arc(cx, cz, dix, diz, dox, doz){   // p0 (approach end) → 3 mids → p2 (exit start)
    var p0x = cx - dix * R, p0z = cz - diz * R, p2x = cx + dox * R, p2z = cz + doz * R;
    var out = [[p0x, p0z]], i, t, mt;
    for (i = 1; i <= 3; i++){
      t = i / 4; mt = 1 - t;
      out.push([mt * mt * p0x + 2 * mt * t * cx + t * t * p2x,
                mt * mt * p0z + 2 * mt * t * cz + t * t * p2z]);
    }
    out.push([p2x, p2z]);
    return out;
  }
  var zN = BUS_LANE, zS = 100 - BUS_LANE, xW = -196.4, xE = 196.4;
  var neA = arc(xE, zN, 1, 0, 0, 1);   // Main E → MLK S
  var seA = arc(xE, zS, 0, 1, -1, 0);  // MLK S → Vine W
  var swA = arc(xW, zS, -1, 0, 0, -1); // Vine W → Broadway N
  var nwA = arc(xW, zN, 0, -1, 1, 0);  // Broadway N → Main E
  var P = [];
  function pt(x, z, stop){ P.push({x: x, z: z, stop: stop}); }
  pt(nwA[4][0], nwA[4][1]);                       // start: just onto Main St eastbound
  pt(BUS_STOPS[0].sx, BUS_STOPS[0].sz, 0);        // VICTORIAN SQUARE
  pt(BUS_STOPS[1].sx, BUS_STOPS[1].sz, 1);        // PHOENIX PARK
  for (var i = 0; i < 5; i++) pt(neA[i][0], neA[i][1]);
  for (i = 0; i < 5; i++) pt(seA[i][0], seA[i][1]);
  pt(BUS_STOPS[2].sx, BUS_STOPS[2].sz, 2);        // LIBRARY
  pt(BUS_STOPS[3].sx, BUS_STOPS[3].sz, 3);        // TRANSIT CENTER
  for (i = 0; i < 5; i++) pt(swA[i][0], swA[i][1]);
  for (i = 0; i < 4; i++) pt(nwA[i][0], nwA[i][1]);  // p0..m3; loop closes to P[0] = nwA[4]
  var acc = 0, n = P.length;
  for (i = 0; i < n; i++){
    var a = P[i], b = P[(i + 1) % n];
    var th = Math.atan2(-(b.z - a.z), b.x - a.x);
    if (a.stop !== undefined){
      busStopArrive[a.stop] = acc;
      busPhases.push({kind: 'dwell', dur: BUS_DWELL, t0: acc, x: a.x, z: a.z, th: th, stopIdx: a.stop});
      acc += BUS_DWELL;
    }
    var d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 0.01){
      busPhases.push({kind: 'move', dur: d / BUS_SPEED * 1000, t0: acc, x0: a.x, z0: a.z, x1: b.x, z1: b.z, th: th});
      acc += d / BUS_SPEED * 1000;
    }
  }
  BUS_PERIOD = acc;
  // heading continuity: a corner is 5 short constant-heading sub-segments, and
  // busSeatWorld rotates seat offsets (up to 3.1m) by th — stepped headings pop
  // a seated rider's camera ~1.2m per step. Give each move phase end headings
  // equal to the circular mean of its neighbours' directions and lerp between
  // them: a no-op on colinear straights, a smooth sweep through corners.
  var mv = [];
  for (i = 0; i < busPhases.length; i++) if (busPhases[i].kind === 'move') mv.push(busPhases[i]);
  for (i = 0; i < mv.length; i++){
    var pv = mv[(i - 1 + mv.length) % mv.length], nx = mv[(i + 1) % mv.length];
    mv[i].th0 = mv[i].th + angDelta(mv[i].th, pv.th) / 2;
    mv[i].th1 = mv[i].th + angDelta(mv[i].th, nx.th) / 2;
  }
})();
function busStateAt(tMs){
  var t = ((tMs % BUS_PERIOD) + BUS_PERIOD) % BUS_PERIOD;
  var ph = busPhases[busPhases.length - 1], i;
  for (i = 0; i < busPhases.length; i++){
    if (t < busPhases[i].t0 + busPhases[i].dur){ ph = busPhases[i]; break; }
  }
  var x, z, th = ph.th, stopIdx = -1, doorOpen = false;
  if (ph.kind === 'dwell'){ x = ph.x; z = ph.z; stopIdx = ph.stopIdx; doorOpen = true; }
  else {
    var f = ph.dur > 0 ? (t - ph.t0) / ph.dur : 0;
    x = ph.x0 + (ph.x1 - ph.x0) * f; z = ph.z0 + (ph.z1 - ph.z0) * f;
    th = ph.th0 + angDelta(ph.th0, ph.th1) * f;   // smooth corner sweep (see boot loop)
  }
  var best = 1e18, ns = 0;
  for (i = 0; i < busStopArrive.length; i++){
    var e = (busStopArrive[i] - t + BUS_PERIOD) % BUS_PERIOD;
    if (doorOpen && i === stopIdx) e += BUS_PERIOD;   // skip the stop we're sitting at
    if (e < best){ best = e; ns = i; }
  }
  return {x: x, z: z, th: th, stopIdx: stopIdx, doorOpen: doorOpen, nextStopIdx: ns, etaMs: best % BUS_PERIOD};
}
function busEtaToStop(tMs, si){
  var t = ((tMs % BUS_PERIOD) + BUS_PERIOD) % BUS_PERIOD;
  return (busStopArrive[si] - t + BUS_PERIOD) % BUS_PERIOD;
}
function busFmtEta(ms){ var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

// bus + shelters + labels (drawn on canvas at boot, like everything else)
var busMesh = new THREE.Group();
(function(){
  var busTex = makeTex(256, 64, function(g, w, h){
    g.fillStyle = '#1f8f74'; g.fillRect(0, 0, w, h);                 // teal body
    g.fillStyle = '#176b57'; g.fillRect(0, h * 0.66, w, h * 0.2);    // lower green band
    g.fillStyle = '#0d2b28';                                         // window strip
    for (var x = 8; x < w - 8; x += 30) g.fillRect(x, 12, 22, 20);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (x = 8; x < w - 8; x += 30) g.fillRect(x, 12, 22, 3);
  });
  var bodyMat = new THREE.MeshStandardMaterial({map: busTex, roughness: 0.6, metalness: 0.15});
  var body = new THREE.Mesh(new THREE.BoxGeometry(11, 2.6, 3), bodyMat);
  body.position.y = 2.3; body.castShadow = true; busMesh.add(body);
  var floor = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 2.6),
    new THREE.MeshStandardMaterial({color: 0x222a2c, roughness: 0.9}));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 1.02; busMesh.add(floor);
  var wheelG = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 10); wheelG.rotateX(Math.PI / 2);
  var wheelMat = new THREE.MeshStandardMaterial({color: 0x14161a, roughness: 0.8});
  [[3.6, 1.4], [3.6, -1.4], [-3.6, 1.4], [-3.6, -1.4]].forEach(function(w){
    var wh = new THREE.Mesh(wheelG, wheelMat); wh.position.set(w[0], 0.55, w[1]); busMesh.add(wh);
  });
  // lit door strip on the +lateral (curb) side; brightens while dwelling
  var doorMat = new THREE.MeshStandardMaterial({color: 0x0a1a16, emissive: 0x9ff4d0, emissiveIntensity: 0});
  var door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 0.1), doorMat);
  door.position.set(1.6, 1.6, 1.52); busMesh.add(door);
  busMesh.userData.doorMat = doorMat;
  // "THE LOOP" head sign on the front (+x end)
  var signTex = makeTex(128, 32, function(g, w, h){
    g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd24a'; g.font = 'bold 17px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('THE LOOP', w / 2, h / 2 + 1);
  });
  var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.85),
    new THREE.MeshStandardMaterial({map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.5}));
  sign.rotation.y = Math.PI / 2; sign.position.set(5.51, 2.9, 0); busMesh.add(sign);
  scene.add(busMesh);
})();
(function(){
  var postMat = new THREE.MeshStandardMaterial({color: 0x3a4247, roughness: 0.7, metalness: 0.3});
  var roofMat = new THREE.MeshStandardMaterial({color: 0x1f8f74, roughness: 0.6});
  var benchMat = new THREE.MeshStandardMaterial({color: 0x5a4634, roughness: 0.9});
  BUS_STOPS.forEach(function(s){
    var g = new THREE.Group();
    var postG = new THREE.BoxGeometry(0.16, 3.0, 0.16);
    [-2, 2].forEach(function(dx){
      var p = new THREE.Mesh(postG, postMat); p.position.set(dx, 1.5, -0.6); g.add(p);
    });
    var roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 1.8), roofMat);
    roof.position.set(0, 3.05, 0); roof.castShadow = true; g.add(roof);
    var bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.55), benchMat);
    bench.position.set(0, 0.6, -0.6); g.add(bench);
    var signTex = makeTex(256, 48, function(gc, w, h){
      gc.fillStyle = '#0d2b28'; gc.fillRect(0, 0, w, h);
      gc.strokeStyle = '#6ef7df'; gc.lineWidth = 3; gc.strokeRect(3, 3, w - 6, h - 6);
      gc.fillStyle = '#eafffa'; gc.font = 'bold 13px Helvetica, Arial, sans-serif';
      gc.textBaseline = 'middle';
      gc.fillText('LEXTOWN TRANSIT', 12, 16);
      gc.fillStyle = '#9adfd2'; gc.font = 'bold 15px Helvetica, Arial, sans-serif';
      gc.fillText(s.name, 12, 34, w - 20);
    });
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.72),
      new THREE.MeshStandardMaterial({map: signTex, roughness: 0.7, side: THREE.DoubleSide}));
    sign.position.set(0, 2.4, 0.92); g.add(sign);
    g.position.set(s.shx, 0, s.shz);
    g.rotation.y = s.th + Math.PI;   // roof/bench span the street; sign + bench face the stop
    scene.add(g);
    // low collider so you can't walk through the shelter (jetpack still clears it)
    colliders.push({x0: s.shx - 2.4, x1: s.shx + 2.4, z0: s.shz - 1.0, z1: s.shz + 1.0, h: 3.2});
    labels.push({name: 'BUS — ' + s.name, x: s.shx, y: 5.4, z: s.shz});   // ambient, not mission gold
  });
})();
var busBoardedT = 0;   // Date.now() at board — for the full-loop telemetry beacon
function busBoardStop(){   // stopIdx you may board right now (doors open, within 6m), else -1
  var bs = busStateAt(Date.now());
  if (!bs.doorOpen) return -1;
  var s = BUS_STOPS[bs.stopIdx];
  var dx = player.x - s.bx, dz = player.z - s.bz;
  return (dx * dx + dz * dz <= 36) ? bs.stopIdx : -1;
}
function canBoardBus(){
  // the bus is legal locomotion during a DAILY DASH run, so allow boarding then too
  return mode === 'player' && !player.veh && !player.heli && !player.ride && player.bus === null &&
    !player.scoot && !isFrozen() && player.grounded && (allIdle() || missionD.stage === 'run') && busBoardStop() >= 0;
}
function boardBus(){
  if (busBoardStop() < 0) return;
  var bs = busStateAt(Date.now());
  player.bus = busSeatFor(myId);
  setPvp(false);   // holster the blaster — a passenger is not a tag target
  rigP.r = Math.max(rigP.r, 17);
  playClip('sfx_door', {gain: 0.6});
  caption('THE LOOP', 'ALL ABOARD — NEXT: ' + BUS_STOPS[bs.nextStopIdx].name, 2400);
  if (radio.st > 0) setTimeout(function(){ if (radioActive()) radioNext(true); }, 900);
  busBoardedT = Date.now();
  mev(60);
}
function leaveBus(){
  if (player.bus === null) return;
  var bs = busStateAt(Date.now());
  // drop on the curb side relative to the bus's CURRENT heading (works mid-route too)
  var lx = Math.sin(bs.th), lz = Math.cos(bs.th);
  var px = bs.x + lx * BUS_CURB, pz = bs.z + lz * BUS_CURB;
  player.bus = null;
  radioStop();
  playClip('sfx_door', {gain: 0.6});
  player.av.g.visible = (mode !== 'player' || !camFP);
  player.x = px; player.z = pz;
  player.y = groundY(px, pz, player.y + 1); player.vy = 0; player.grounded = false;
  collide(player, 0.55, player.y);
  if (busBoardedT && Date.now() - busBoardedT >= BUS_PERIOD) mev(62);   // rode a full loop
  busBoardedT = 0;
  mev(61);
}
function busWaitHint(){   // 'BUS IN m:ss — NAME' when idling on foot within 25m of a stop
  if (mode !== 'player' || player.veh || player.heli || player.ride || player.bus !== null || player.scoot) return '';
  if (isFrozen() || !(allIdle() || missionD.stage === 'run')) return '';
  var best = -1, bd = 625, i;   // 25m squared
  for (i = 0; i < BUS_STOPS.length; i++){
    var s = BUS_STOPS[i];
    var dx = player.x - s.bx, dz = player.z - s.bz, d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = i; }
  }
  if (best < 0) return '';
  var bs = busStateAt(Date.now());
  if (bs.doorOpen && bs.stopIdx === best) return 'DOORS OPEN — ' + BUS_STOPS[best].name;
  return 'BUS IN ' + busFmtEta(busEtaToStop(Date.now(), best)) + ' — ' + BUS_STOPS[best].name;
}
function updateBus(dt){   // wall-clock: animates even while the sim is paused
  var bs = busStateAt(Date.now());
  busMesh.position.set(bs.x, groundY(bs.x, bs.z), bs.z);
  busMesh.rotation.y = bs.th;
  busMesh.userData.doorMat.emissiveIntensity = bs.doorOpen ? 1.1 : 0;
}
function updateBusRide(dt){   // pin the rider to their deterministic seat BEFORE netTick/cam
  if (player.bus === null || mode !== 'player') return;
  var seat = busSeatWorld(busStateAt(Date.now()), player.bus);
  player.x = seat.x; player.y = seat.y; player.z = seat.z; player.ry = seat.ry;
  player.moving = 0; player.thrusting = false; player.grounded = true;
  setSwing(player.av, 0, 0);
  player.av.g.position.set(seat.x, seat.y, seat.z);
  player.av.g.rotation.y = seat.ry;
}

// ---------- SCOOTER SHARE (F3) ----------
// Kick-scooters racked around downtown: the missing rung between walking and
// driving. On foot, press E within 2.2 m of a rack scooter to hop on, ride at
// ~double walk speed (9.5 m/s), drop it anywhere with E. Scooters themselves are
// LOCAL-ONLY (each client renders its own set, like ambient traffic) — riders are
// synced over the new m:5 mode (server CAPS[5]); a remote rider gets a shared
// scooter mesh drawn under their standing avatar. Mount stays visible + standing
// (hands on the bars), unlike a car — so it rides through updateScoot, NOT the
// passenger seat-pose path.
var SCOOT_MAX = 9.5;        // top speed (m/s) — matches server CAPS[5] budget
var SCOOT_GREEN = 0x3fce7a; // rental-green accent
// deck + stem + handlebar + 2 wheels. Long axis = +x (forward at th=0, matching
// the car body), origin at ground so wheels touch when g.position.y = groundY.
function buildScooter(){
  var g = new THREE.Group();
  var deckMat = new THREE.MeshStandardMaterial({color: 0x2a2e33, roughness: 0.6, metalness: 0.3});
  var accentMat = new THREE.MeshStandardMaterial({color: SCOOT_GREEN, roughness: 0.5, metalness: 0.2});
  var wheelMat = new THREE.MeshStandardMaterial({color: 0x14161a, roughness: 0.8});
  var deck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.34), accentMat);
  deck.position.set(0, 0.3, 0); deck.castShadow = true; g.add(deck);
  var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.15, 8), deckMat);
  stem.position.set(0.62, 0.86, 0); stem.rotation.z = 0.3; g.add(stem);
  var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8), deckMat);
  bar.rotation.x = Math.PI / 2; bar.position.set(0.72, 1.36, 0); g.add(bar);
  var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.74, 8), accentMat);
  grip.rotation.x = Math.PI / 2; grip.position.set(0.72, 1.36, 0); g.add(grip);
  var wg = new THREE.CylinderGeometry(0.26, 0.26, 0.12, 12); wg.rotateX(Math.PI / 2);
  [0.66, -0.66].forEach(function(wx){
    var wh = new THREE.Mesh(wg, wheelMat); wh.position.set(wx, 0.26, 0); wh.castShadow = true; g.add(wh);
  });
  scene.add(g);
  return g;
}
// Racks: a low bar on two posts + a SCOOTERS label; each spawns 2 scooters just
// in front (fwd = cos a, -sin a; scooters line up along the lateral sin a, cos a).
// `a` points the scooters at open ground so the mount approach is never blocked
// by the rack's own (thin, low) collider.
var scooters = [];
var SCOOT_RACKS = [
  {name: 'TRANSIT CENTER',   x: -72,  z: 86,  a: -Math.PI / 2},  // Vine St hub, near the LexTran shelter
  {name: 'COURTHOUSE PLAZA', x: 56,   z: -18, a: -Math.PI / 2},  // Cheapside paver plaza, north of the old courthouse
  {name: 'TRIANGLE PARK',    x: -158, z: 22,  a: Math.PI / 2},   // the wedge park green west of Big Blue
  {name: 'UK CAMPUS',        x: 178,  z: 416, a: Math.PI / 2}    // the quad green, just off Euclid
];
(function(){
  var postMat = new THREE.MeshStandardMaterial({color: 0x3a4247, roughness: 0.7, metalness: 0.3});
  var railMat = new THREE.MeshStandardMaterial({color: SCOOT_GREEN, roughness: 0.5, metalness: 0.2});
  SCOOT_RACKS.forEach(function(rk){
    var fx = Math.cos(rk.a), fz = -Math.sin(rk.a);   // forward (toward open ground)
    var lx = Math.sin(rk.a), lz = Math.cos(rk.a);    // lateral (along the rack bar)
    var g = new THREE.Group();
    [-0.8, 0.8].forEach(function(dl){
      var p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), postMat);
      p.position.set(lx * dl, 0.45, lz * dl); g.add(p);
    });
    var rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.9), railMat);
    rail.rotation.y = -rk.a; rail.position.y = 0.78; g.add(rail);
    g.position.set(rk.x, groundY(rk.x, rk.z), rk.z);
    scene.add(g);
    // thin, low collider on the rack bar only (jetpack clears it; the scooters
    // sit ~1.5 m forward on open ground so the 2.2 m mount reach isn't blocked)
    colliders.push({x0: rk.x - Math.abs(lx) * 0.9 - 0.2, x1: rk.x + Math.abs(lx) * 0.9 + 0.2,
                    z0: rk.z - Math.abs(lz) * 0.9 - 0.2, z1: rk.z + Math.abs(lz) * 0.9 + 0.2, h: 0.9});
    labels.push({name: 'SCOOTERS — ' + rk.name, x: rk.x, y: 4.4, z: rk.z});   // ambient (cyan), not mission gold — like the bus stop labels
    [-0.55, 0.55].forEach(function(dl){
      var sx = rk.x + fx * 1.5 + lx * dl, sz = rk.z + fz * 1.5 + lz * dl;
      var s = {g: buildScooter(), x: sx, z: sz, th: rk.a, taken: false, spd: 0};
      s.g.position.set(sx, groundY(sx, sz), sz); s.g.rotation.y = rk.a;
      scooters.push(s);
    });
  });
})();
function nearScooter(){
  if (!player.grounded) return null;
  var best = null, bd = 2.2 * 2.2, k;
  for (k = 0; k < scooters.length; k++){
    var s = scooters[k];
    if (s.taken) continue;
    var dx = s.x - player.x, dz = s.z - player.z, d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = s; }
  }
  return best;
}
function canMountScoot(){
  // rideable mid-DAILY DASH run (like the bus) — legal locomotion during a dash.
  // Do NOT loosen this gate to other missions without work elsewhere: the ghost
  // recorder samples only m 0/2 and DEADLINE's checkpoint banking assumes a car.
  return mode === 'player' && !player.veh && !player.heli && !player.ride && player.bus === null &&
    !player.scoot && !isFrozen() && player.grounded &&
    (allIdle() || missionD.stage === 'run') && nearScooter() !== null;
}
function mountScoot(){
  var s = nearScooter();
  if (!s) return;
  player.scoot = s; s.taken = true; s.spd = 0;
  setPvp(false);   // hands on the bars — a rider is not a tag target and can't fire
  player.x = s.x; player.z = s.z; player.ry = s.th;
  player.y = groundY(s.x, s.z, player.y + 1); player.vy = 0; player.grounded = true;
  playClip('sfx_door', {gain: 0.4});
  caption('SCOOTER', 'HOP ON — E TO HOP OFF', 2000);
}
function dismountScoot(){
  var s = player.scoot;
  if (!s) return;
  s.x = player.x; s.z = player.z; s.th = player.ry; s.spd = 0; s.taken = false;   // park at the drop spot
  s.g.position.set(s.x, groundY(s.x, s.z), s.z); s.g.rotation.y = s.th;
  var lx = Math.sin(player.ry), lz = Math.cos(player.ry);   // step off to the side (mirrors the car exit-drop)
  var px = player.x + lx * 1.4, pz = player.z + lz * 1.4;
  player.scoot = null;
  playClip('sfx_door', {gain: 0.4});
  player.x = px; player.z = pz;
  player.y = groundY(px, pz, player.y + 1); player.vy = 0; player.grounded = false;
  collide(player, 0.55, player.y);
  player.av.g.visible = (mode !== 'player' || !camFP);
  player.av.armL.rotation.x = 0; player.av.armR.rotation.x = 0;   // drop the bar pose; walking takes over next frame
}
// physics — mirrors updateDrive's shape (accel/brake/steer/collide/crunch) but
// grounded-only, avatar-visible, and livelier steering at low speed.
function updateScoot(dt){
  var s = player.scoot;
  var fwd = keysDown.w || keysDown.arrowup, back = keysDown.s || keysDown.arrowdown;
  var left = keysDown.a || keysDown.arrowleft, right = keysDown.d || keysDown.arrowright;
  if (stick.active){ fwd = stick.y < -0.25; back = stick.y > 0.25;
                     left = stick.x < -0.3; right = stick.x > 0.3; }
  if (isFrozen()){ fwd = back = left = right = false; }
  if (fwd) s.spd += 8 * dt;
  else if (back) s.spd -= 12 * dt;
  else s.spd -= Math.sign(s.spd) * Math.min(Math.abs(s.spd), (3 + Math.abs(s.spd) * 0.4) * dt);
  s.spd = Math.max(-2, Math.min(SCOOT_MAX, s.spd));
  // steer factor 1.9*dt like the car, but the low-speed floor (0.55) keeps it
  // nimble at a crawl where the car (min speed/9) barely turns
  var stt = (left ? 1 : 0) - (right ? 1 : 0);
  s.th += stt * (0.55 + 0.45 * Math.min(1, Math.abs(s.spd) / 6)) * 1.9 * dt * (s.spd >= 0 ? 1 : -1);
  var fx = Math.cos(s.th), fz = -Math.sin(s.th);
  var p = {x: player.x + fx * s.spd * dt, z: player.z + fz * s.spd * dt};
  var ox = p.x, oz = p.z;
  collide(p, 0.6, player.y);
  if (p.x !== ox || p.z !== oz) s.spd *= 0.3;   // crunch
  p.x = Math.max(X0 - 20, Math.min(X1 + 20, p.x));
  p.z = Math.max(Z0 - 20, Math.min(Z1 + 20, p.z));
  var gy = groundY(p.x, p.z, player.y);
  player.x = p.x; player.z = p.z; player.y = gy; player.vy = 0; player.grounded = true;
  player.ry = s.th;
  player.moving = Math.abs(s.spd);
  player.thrusting = false;
  player.fuel = Math.min(100, player.fuel + 30 * dt);
  jumpQueued = false;   // no jump while mounted — don't let a queued jump fire on dismount
  // scooter mesh rides under the standing rider; avatar stands, hands on the bars
  s.g.position.set(player.x, gy, player.z); s.g.rotation.y = s.th;
  setSwing(player.av, 0, 0);
  player.av.armL.rotation.x = -1.1; player.av.armR.rotation.x = -1.1;
  player.av.flames.forEach(function(fl){ fl.visible = false; });
  player.av.g.position.set(player.x, player.y, player.z);
  player.av.g.rotation.y = player.ry;
}
function buildRemoteScooter(){ return buildScooter(); }   // shared remote mesh, mirrors buildRemoteCar

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
  door.ring.visible = heliUnlocked && allIdle();
  if (door.ring.visible) door.ring.rotation.z += dt * 0.8;
  updateSnowPts(dt);
  // overcast blend handled in frame() via m2Sky
  var storm = mission2.stage === 'plow' || mission2.stage === 'brief';
  m2Sky += ((storm ? 1 : 0) - m2Sky) * Math.min(1, dt * (storm ? 0.5 : 0.35));
  if (mission2.stage === 'idle') return;
  mission2.tStage += dt;
  var t = mission2.tStage;
  if (mission2.stage === 'brief'){
    if (t > 3.6 && mission2.capIdx === 0){ mission2.capIdx = 1; caption('THE MAYOR', 'FREAK SNOWSTORM INBOUND. THE STREETS NEED PLOWING AND MY PLOW GUY IS AT THE LAKE.', 4400); }
    if (t > 10.8 && mission2.capIdx === 1){ mission2.capIdx = 2; caption('THE MAYOR', 'TAKE THE TRUCK ON MAIN. BLADE DOWN ON SNOW ONLY - YOU GRIND MY ROADS, I HEAR IT.', 4600); }
    if (t > 17.8 && mission2.capIdx === 2){ mission2.capIdx = 3; caption('THE MAYOR', 'WHATEVER YOU DO, DON\'T PLOW MY STREET. I GOT HALF OF REDDIT CAMPED OUT THERE WATCHING FOR THE PLOWS NOW.', 5200); }
    if (t > 26.6){
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
      sendScore({t: 'score', ms: Math.round(mission2.ms), m: 2});
    }
    return;
  }
  if (mission2.stage === 'won'){
    if (t > 6.4 && mission2.capIdx !== 9){
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

// ---------- mission 3: THE DATA CENTER ----------
// The mayor (off the record, on a Phoenix Park bench) has you tail Councilman
// Graft up Limestone to Al's Bar, eavesdrop on his developer meeting (a data
// center hidden inside luxury student housing at UK — just bulldoze a few
// historic buildings that are DEFINITELY NOT already falling down), then
// photograph the two of them scouting the quad. The photos leak on reddit,
// the data center dies, and Graft officially reswigens.
var M3_TRIG = {x: 122, z: 76};                 // Phoenix Park bench
var M3_LZ = {x: 140.5, z: -580.5};             // Al's back patio meeting spot
var M3_QUAD = {x: 200, z: 530};                // UK quad scouting area
var m3Best = 0;
try { m3Best = parseInt(localStorage.getItem('lt_m3_best') || '0', 10) || 0; } catch (e){}
var mission3 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, capIdx: 0,
                sus: 0, listen: 0, li: 0, breathed: false, photos: 0, lastShot: 0};
var m3Npcs = [], m3Mayor = null, m3Graft = null, m3Dev = null, m3Car = null;
var m3Ring = null, m3Obj = null;
(function(){
  m3Ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0x25f4ee, transparent: true, opacity: 0.85}));
  m3Ring.rotation.x = Math.PI / 2;
  m3Ring.position.set(M3_TRIG.x, 0.9, M3_TRIG.z);
  scene.add(m3Ring);
  m3Obj = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.09, 6, 24),
    new THREE.MeshBasicMaterial({color: 0x25f4ee, transparent: true, opacity: 0.7}));
  m3Obj.rotation.x = Math.PI / 2;
  m3Obj.visible = false;
  scene.add(m3Obj);
})();
function nearM3Trig(){
  var dx = player.x - M3_TRIG.x, dz = player.z - M3_TRIG.z;
  return dx * dx + dz * dz < 16;
}
// Graft's sedan: wrong way up Limestone, obviously
var M3_PATH = [[150, 5], [104, 5], [104, -592], [122, -596]];
function buildM3Car(){
  var g = new THREE.Group();
  var body = new THREE.Mesh(bodyG, new THREE.MeshStandardMaterial({color: 0x1c1f26, roughness: 0.35, metalness: 0.5}));
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  var cab = new THREE.Mesh(cabG, cabMat); cab.position.set(-0.25, 1.55, 0); g.add(cab);
  g.position.set(M3_PATH[0][0], 0.15, M3_PATH[0][1]);
  scene.add(g);
  return {g: g, seg: 0, s: 0, done: false};
}
function m3CarPos(){ return m3Car ? m3Car.g.position : null; }
function startMission3(){
  mission3.stage = 'brief'; mission3.tStage = 0; mission3.capIdx = 0;
  mission3.t0 = 0; mission3.sus = 0; mission3.listen = 0;
  mission3.li = 0; mission3.breathed = false;
  mission3.photos = 0; mission3.lastShot = 0;
  m3Mayor = spawnNpc(M3_TRIG.x, M3_TRIG.z - 3, 0x8f2f3c, 0, 0.95);
  m3Npcs.push(m3Mayor);
  caption('THE MAYOR', 'OH GOOD, IT\'S YOU. SIT. PRETEND WE\'RE DISCUSSING PIGEONS.', 3600);
  addChatLine('* MISSION', 'THE DATA CENTER - tail the councilman', true);
}
function m3Cleanup(){
  mission3.stage = 'idle';
  m3Npcs.forEach(function(g){ scene.remove(g); });
  m3Npcs.length = 0;
  m3Mayor = m3Graft = m3Dev = null;
  if (m3Car){ scene.remove(m3Car.g); m3Car = null; }
  if (m3Obj) m3Obj.visible = false;
}
function m3Fail(why){
  mission3.stage = 'fail'; mission3.tStage = 0;
  caption('THE MAYOR', why === 'timeout'
    ? 'TOO SLOW. THE ZONING PASSED WHILE YOU WERE SIGHTSEEING.'
    : 'HE MADE YOU. NOW HE\'S PRETENDING TO JOG. INVESTIGATION BLOWN.', 4600);
}
// walk an npc toward a point; returns true when arrived
function npcWalk(g, tx, tz, spd, dt){
  var dx = tx - g.position.x, dz = tz - g.position.z;
  var d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  var step = Math.min(d, spd * dt);
  g.position.x += dx / d * step;
  g.position.z += dz / d * step;
  g.position.y = groundY(g.position.x, g.position.z) + 0.02;
  g.rotation.y = Math.atan2(dx, dz);
  return false;
}
var _psLast = {x: 0, z: 0, v: 0};
function trackPlayerSpeed(dt){
  var dx = player.x - _psLast.x, dz = player.z - _psLast.z;
  var v = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
  _psLast.v = v > 30 ? 0 : v;   // teleports don't count as running
  _psLast.x = player.x; _psLast.z = player.z;
}
function playerSpeed(){
  if (player.veh) return Math.abs(player.veh.spd);
  return _psLast.v;
}
var _camDir = new THREE.Vector3();
function takePhoto(){
  if (mission3.stage !== 'photo' || !m3Graft) return;
  var now = performance.now();
  var tx = m3Graft.position.x, tz = m3Graft.position.z;
  var d = Math.hypot(tx - player.x, tz - player.z);
  if (now - mission3.lastShot < 3500){
    caption('CAMERA', 'RECHARGING. IT\'S A DISPOSABLE.', 1800);
    return;
  }
  if (d > 45){ caption('CAMERA', 'TOO FAR. ZOOM WITH YOUR LEGS.', 2200); return; }
  camera.getWorldDirection(_camDir);
  var hl = Math.hypot(_camDir.x, _camDir.z) || 1;   // aim check is horizontal-only
  var vx = tx - camera.position.x, vz = tz - camera.position.z;
  var vl = Math.hypot(vx, vz) || 1;
  if ((_camDir.x / hl) * (vx / vl) + (_camDir.z / hl) * (vz / vl) < 0.82){
    caption('CAMERA', 'THAT IS A PHOTO OF NOTHING. AIM AT THEM.', 2200);
    return;
  }
  mission3.lastShot = now;
  mission3.photos++;
  for (var f = 0; f < 4; f++)
    puff(tx + (Math.random() - 0.5) * 3, 2 + Math.random() * 1.5, tz + (Math.random() - 0.5) * 3,
      0xffffff, 0.4, 6, 220, 0, 0.9);
  sndTone(1500, 0.05, 0, 'square', 0.14);
  caption('CAMERA', 'PHOTO ' + Math.min(3, mission3.photos) + '/3' +
    (mission3.photos === 1 ? ' — GREAT POINTING' : mission3.photos === 2 ? ' — VERY CONSPIRATORIAL' : ' — FRONT PAGE'), 2400);
  if (mission3.photos >= 3){
    mission3.stage = 'return'; mission3.tStage = 0; mission3.capIdx = 0;
    m3Obj.position.set(M3_TRIG.x, 0.9, M3_TRIG.z);
    caption('THE MAYOR', '(TEXT) GOT THEM? BRING ME THE CAMERA. I\'LL DO THE REST.', 4200);
  }
}
var M3_LISTEN_CAPS = [
  ['GRAFT', 'RELAX. NOBODY COMES TO A BAR TO LISTEN.'],
  ['DEVELOPER', 'PICTURE THIS: LUXURY STUDENT HOUSING. BUT THE AMENITY FLOORS ARE A DATA CENTER.'],
  ['GRAFT', 'THE STUDENTS LOVE WARM FLOORS. SERVERS RUN HOT. IT\'S A WELLNESS FEATURE.'],
  ['DEVELOPER', 'WE JUST NEED TO BULLDOZE A FEW OF THE HISTORIC BUILDINGS AT UK.'],
  ['GRAFT', 'WHICH ARE ALREADY FALLING DOWN, RIGHT?'],
  ['DEVELOPER', 'THEY ARE DEFINITELY NOT ALREADY FALLING DOWN. GORGEOUS BONES. EXTREMELY STANDING.'],
  ['GRAFT', 'PERFECT. WE\'LL CALL THE ZONING AMBIGUOUS. ZONING IS ALWAYS AMBIGUOUS.'],
  ['DEVELOPER', 'MEET ME AT THE QUAD. BRING YOUR POINTING FINGER. WE\'RE SCOUTING.']
];
// each line holds for its own reading time (~20 cps + a beat, 3s floor)
var M3_LISTEN_AT = (function(){
  var t = 0.8, at = [];
  M3_LISTEN_CAPS.forEach(function(c){ at.push(t); t += Math.max(3, 0.6 + c[1].length * 0.05); });
  at.push(t + 0.4);   // final entry = total scene length
  return at;
})();
var M3_SCOUT_PTS = [[165, 522], [208, 545], [242, 530], [192, 508]];
function updateMission3(dt){
  if (m3Ring){
    m3Ring.visible = allIdle();
    if (m3Ring.visible) m3Ring.rotation.z += dt * 0.8;
  }
  if (m3Obj && m3Obj.visible) m3Obj.rotation.z += dt * 1.1;
  if (mission3.stage === 'idle') return;
  var now = performance.now();
  mission3.tStage += dt;
  var t = mission3.tStage;
  if (mission3.t0 && (now - mission3.t0) / 1000 > 600 &&
      mission3.stage !== 'won' && mission3.stage !== 'post' && mission3.stage !== 'fail'){
    m3Fail('timeout'); return;
  }
  if (mission3.stage === 'brief'){
    if (t > 5.6 && mission3.capIdx === 0){ mission3.capIdx = 1; caption('THE MAYOR', 'OFF THE RECORD: COUNCILMAN GRAFT HAS BEEN TAKING A LOT OF MEETINGS.', 4400); }
    if (t > 12 && mission3.capIdx === 1){ mission3.capIdx = 2; caption('THE MAYOR', 'THAT\'S HIM BY CITY HALL. FOLLOW HIM. DON\'T BE WEIRD ABOUT IT.', 4200); }
    if (t > 17.8 && mission3.capIdx === 2){ mission3.capIdx = 3; caption('THE MAYOR', 'IF HE LOOKS AT YOU, BE A PEDESTRIAN. NOBODY SUSPECTS PEDESTRIANS.', 4200); }
    if (t > 24){
      mission3.stage = 'tail'; mission3.tStage = 0; mission3.capIdx = 0;
      mission3.t0 = now;
      m3Graft = spawnNpc(158, 12, 0x39404a, -Math.PI / 2, 0.95);
      m3Npcs.push(m3Graft);
      m3Dev = spawnNpc(M3_LZ.x + 1.5, M3_LZ.z - 2, 0xc9a44a, Math.PI, 0.95);
      m3Npcs.push(m3Dev);
      m3Car = buildM3Car();
      caption('DISPATCH', 'CLOCK STARTED. STAY WITH HIM. GRAB ANY CAR IF YOU HAVE TO.', 4000);
    }
    return;
  }
  if (mission3.stage === 'tail'){
    // Graft walks to his sedan, then drives the path; pauses if you fall behind
    if (!m3Car.boarded){
      if (npcWalk(m3Graft, M3_PATH[0][0], M3_PATH[0][1] + 2, 3.4, dt)){
        m3Car.boarded = true;
        m3Graft.visible = false;
        caption('GRAFT', 'WRONG WAY UP LIMESTONE. PERKS OF PUBLIC SERVICE.', 3600);
      }
      return;
    }
    if (!m3Car.done){
      var cp = m3Car.g.position;
      var pd = Math.hypot(cp.x - player.x, cp.z - player.z);
      if (pd > 130){
        if (mission3.capIdx < 1){ mission3.capIdx = 1; caption('DISPATCH', 'HE CAUGHT A RED LIGHT. CATCH UP.', 3200); }
      } else {
        if (mission3.capIdx === 1) mission3.capIdx = 0;
        var a = M3_PATH[m3Car.seg], b = M3_PATH[m3Car.seg + 1];
        var sdx = b[0] - a[0], sdz = b[1] - a[1];
        var slen = Math.hypot(sdx, sdz);
        m3Car.s += 10.5 * dt;
        if (m3Car.s >= slen){
          m3Car.s = 0; m3Car.seg++;
          if (m3Car.seg >= M3_PATH.length - 1){ m3Car.done = true; }
        } else {
          cp.set(a[0] + sdx / slen * m3Car.s, 0.15, a[1] + sdz / slen * m3Car.s);
          m3Car.g.rotation.y = Math.atan2(sdx, sdz) - Math.PI / 2;
        }
      }
      return;
    }
    // parked: Graft walks to the patio
    if (!m3Graft.visible){
      m3Graft.visible = true;
      m3Graft.position.set(m3Car.g.position.x, 0.72, m3Car.g.position.z);
      caption('GRAFT', 'PARKING IS FREE IF YOU\'RE ON THE COUNCIL. PROBABLY.', 3400);
    }
    if (npcWalk(m3Graft, M3_LZ.x, M3_LZ.z + 1.5, 3.2, dt)){
      mission3.stage = 'listen'; mission3.tStage = 0; mission3.capIdx = 0;
      mission3.listen = 0; mission3.sus = 0;
      mission3.li = 0; mission3.breathed = false;
      caption('DISPATCH', 'HE\'S MEETING SOMEONE BEHIND AL\'S. GET CLOSE ENOUGH TO HEAR. NOT CLOSER.', 4400);
    }
    return;
  }
  if (mission3.stage === 'listen'){
    var ld = Math.hypot(M3_LZ.x - player.x, M3_LZ.z - player.z);
    if (ld < 6.5){
      mission3.sus += dt / 3;
      if (mission3.sus > 0.5 && !mission3.breathed){
        mission3.breathed = true;
        caption('GRAFT', '...DO YOU HEAR BREATHING?', 2600);
      }
      if (mission3.sus >= 1){ m3Fail('seen'); return; }
    } else {
      mission3.sus = Math.max(0, mission3.sus - dt / 2);
      if (mission3.sus < 0.2) mission3.breathed = false;
    }
    if (ld >= 6.5 && ld < 17){
      mission3.listen += dt;
      if (mission3.li < M3_LISTEN_CAPS.length && mission3.listen >= M3_LISTEN_AT[mission3.li]){
        caption(M3_LISTEN_CAPS[mission3.li][0], M3_LISTEN_CAPS[mission3.li][1]);
        mission3.li++;
      }
      if (mission3.listen > M3_LISTEN_AT[M3_LISTEN_CAPS.length]){
        mission3.stage = 'scout'; mission3.tStage = 0; mission3.capIdx = 0;
        m3Obj.visible = true;
        m3Obj.position.set(M3_QUAD.x, 0.9, M3_QUAD.z);
        caption('THE MAYOR', '(TEXT) A DATA CENTER??? GET TO THE UK QUAD BEFORE THEM. TAKE PHOTOS. F IS THE CAMERA.', 5000);
      }
    }
    return;
  }
  if (mission3.stage === 'scout'){
    // they take the sedan; you take the hint
    if (m3Graft){ m3Graft.visible = false; m3Dev.visible = false; if (m3Car) m3Car.g.visible = false; }
    var qd = Math.hypot(M3_QUAD.x - player.x, M3_QUAD.z - player.z);
    if (qd < 40){
      mission3.stage = 'photo'; mission3.tStage = 0; mission3.capIdx = 0; mission3.sus = 0;
      m3Obj.visible = false;
      m3Graft.visible = true; m3Dev.visible = true;
      m3Graft.position.set(M3_SCOUT_PTS[0][0], 0.72, M3_SCOUT_PTS[0][1]);
      m3Dev.position.set(M3_SCOUT_PTS[0][0] + 3, 0.72, M3_SCOUT_PTS[0][1] + 2);
      m3Graft.wp = 1;
      caption('DEVELOPER', 'SEE, THE HISTORIC PART COMES RIGHT OFF. THE REST IS BASICALLY A SERVER RACK ALREADY.', 4600);
    }
    return;
  }
  if (mission3.stage === 'photo'){
    // the pair drift between scouting spots, pointing at buildings
    var wp = M3_SCOUT_PTS[m3Graft.wp];
    if (npcWalk(m3Graft, wp[0], wp[1], 1.5, dt)) m3Graft.wp = (m3Graft.wp + 1) % M3_SCOUT_PTS.length;
    npcWalk(m3Dev, m3Graft.position.x + 2.6, m3Graft.position.z + 1.8, 1.7, dt);
    var pd2 = Math.hypot(m3Graft.position.x - player.x, m3Graft.position.z - player.z);
    if (pd2 < 7){
      mission3.sus += dt / 3;
      if (mission3.sus > 0.45 && mission3.capIdx !== 91){
        mission3.capIdx = 91;
        caption('GRAFT', 'IS THAT GUY TAKING PHOTOS OF US?', 2600);
      }
      if (mission3.sus >= 1){ m3Fail('seen'); return; }
    } else mission3.sus = Math.max(0, mission3.sus - dt / 2);
    if (t > 6 && mission3.capIdx === 0){
      mission3.capIdx = 1;
      caption('GRAFT', 'AND THE QUAD BECOMES A COOLING POND. STUDENTS LOVE PONDS.', 4200);
    }
    return;
  }
  if (mission3.stage === 'return'){
    m3Obj.visible = true;
    var rd = Math.hypot(M3_TRIG.x - player.x, M3_TRIG.z - player.z);
    if (rd < 6){
      mission3.ms = now - mission3.t0;
      mission3.stage = 'won'; mission3.tStage = 0; mission3.capIdx = 0;
      m3Obj.visible = false;
      sndWin();
      caption('THE MAYOR', 'THESE ARE PERFECT. WELL... BLURRY. PERFECTLY BLURRY.', 4000);
      try {
        if (!m3Best || mission3.ms < m3Best){
          m3Best = mission3.ms;
          localStorage.setItem('lt_m3_best', String(Math.round(mission3.ms)));
        }
      } catch (e){}
      sendScore({t: 'score', ms: Math.round(mission3.ms), m: 3});
    }
    return;
  }
  if (mission3.stage === 'won'){
    if (t > 5.2 && mission3.capIdx === 0){ mission3.capIdx = 1; caption('RADIO', 'BREAKING: SECRET DATA CENTER PHOTOS HIT R/LEXINGTON. 40,000 UPVOTES. THE COMMENTS ARE NOT KIND.', 5000); }
    if (t > 13.2 && mission3.capIdx === 1){ mission3.capIdx = 2; caption('RADIO', 'THE DEVELOPER NOW SAYS THE DATA CENTER WAS "MORE OF A VIBE".', 4400); }
    if (t > 19 && mission3.capIdx === 2){ mission3.capIdx = 3; caption('RADIO', 'COUNCILMAN GRAFT HAS RESIGNED TO SPEND MORE TIME WITH HIS DATA.', 5000); }
    if (t > 25 && mission3.capIdx === 3){
      mission3.capIdx = 4;
      sndApplause();
      caption('THE MAYOR', 'THE HISTORIC BUILDINGS REMAIN DEFINITELY NOT ALREADY FALLING DOWN. GOOD WORK.', 4600);
      showScores(mission3.ms, 3);
      mission3.stage = 'post'; mission3.tStage = 0;
    }
    return;
  }
  if (mission3.stage === 'fail'){ if (t > 5) m3Cleanup(); return; }
  if (mission3.stage === 'post'){ if (t > 22) m3Cleanup(); }
}

// ---------- mission 4: HORSEPOWER ----------
// Three thoroughbreds got loose the night before the big auction. One is in
// Thoroughbred Park pretending to be a statue. Walk up slow, take the lead
// rope (E), and get them back to the Elmendorf paddock — a calmed horse
// follows you on foot, and if you get in a car, the horse gets in the car.
var M4_TRIG = {x: 247, z: 74};
var M4_PEN = {x0: -500, z0: -1265, x1: -222, z1: -1095};   // Elmendorf paddock
var M4_PEN_T = {x: -320, z: -1180};                        // trot-in target
var m4Best = 0;
try { m4Best = parseInt(localStorage.getItem('lt_m4_best') || '0', 10) || 0; } catch (e){}
var mission4 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, capIdx: 0, penned: 0, capAt: 0};
var m4Npcs = [], m4Horses = [], m4Ring = null, m4PenRing = null;
var M4_SPOTS = [
  {x: 238, z: 44,   col: 0x51341f, name: 'THE STATUE ONE'},
  {x: -240, z: 500, col: 0xb9b3aa, name: 'THE TAILGATER'},
  {x: 488, z: 411.5, col: 0x6e4526, name: 'THE FLOWERS GUY'}
];
var M4_NOPE = ['NOPE.', 'HE DECLINES.', 'THE HORSE HAS OPINIONS.', 'HE\'S FASTER THAN YOU AND HE KNOWS IT.'];
(function(){
  m4Ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0x7cff4f, transparent: true, opacity: 0.85}));
  m4Ring.rotation.x = Math.PI / 2;
  m4Ring.position.set(M4_TRIG.x, 0.9, M4_TRIG.z);
  scene.add(m4Ring);
  m4PenRing = new THREE.Mesh(new THREE.TorusGeometry(3, 0.12, 6, 28),
    new THREE.MeshBasicMaterial({color: 0x7cff4f, transparent: true, opacity: 0.7}));
  m4PenRing.rotation.x = Math.PI / 2;
  m4PenRing.position.set(-228, 0.9, -1180);
  m4PenRing.visible = false;
  scene.add(m4PenRing);
})();
function nearM4Trig(){
  var dx = player.x - M4_TRIG.x, dz = player.z - M4_TRIG.z;
  return dx * dx + dz * dz < 16;
}
function makeLiveHorse(col){
  var g = new THREE.Group();
  var coat = new THREE.MeshStandardMaterial({color: col, roughness: 0.85});
  var body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.15, 1.05), coat);
  body.position.y = 1.85; body.castShadow = true; g.add(body);
  var neck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 0.55), coat);
  neck.position.set(1.75, 2.5, 0); neck.rotation.z = 0.7; g.add(neck);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 0.48), coat);
  head.position.set(2.3, 3.0, 0); g.add(head);
  var tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, 0.16), coat);
  tail.position.set(-1.7, 1.45, 0); tail.rotation.z = 0.3; g.add(tail);
  for (var l = 0; l < 4; l++){
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.35, 0.24), coat);
    leg.position.set(l < 2 ? 1.15 : -1.15, 0.68, l % 2 ? 0.32 : -0.32);
    g.add(leg);
  }
  scene.add(g);
  return g;
}
function startMission4(){
  mission4.stage = 'brief'; mission4.tStage = 0; mission4.capIdx = 0;
  mission4.t0 = 0; mission4.penned = 0; mission4.capAt = 0;
  mev(10);   // funnel: mission start
  var trainer = spawnNpc(245, 68, 0x4a7a52, Math.PI, 0.95);
  m4Npcs.push(trainer);
  // First-ever attempt leads with the spook rule (the likeliest reason m4
  // stalls); once coached, returning players get the flavor intro instead.
  // One caption() call only — a second would clobber the first the same frame.
  var m4Coached = true;
  try { m4Coached = localStorage.getItem('lt_m4_coached') === '1'; } catch (e){}
  if (!m4Coached){
    caption('THE TRAINER', 'WALK UP SLOW - RUN AND THE HORSE BOLTS.', 4200);
    try { localStorage.setItem('lt_m4_coached', '1'); } catch (e){}
  } else {
    caption('THE TRAINER', 'YOU. HORSE EMERGENCY. THREE OF OURS GOT LOOSE. THE AUCTION IS TONIGHT.', 4400);
  }
  addChatLine('* MISSION', 'HORSEPOWER - bring the loose horses home', true);
}
function m4Cleanup(){
  // funnel: incomplete attempt. Cleanup is only ever reached from 'fail' (the
  // 900s timeout) or 'post' (after a win); gating on non-won/post + penned<3
  // captures the timeout-abandon and excludes the natural post-win path.
  if ((mission4.stage === 'brief' || mission4.stage === 'wrangle' || mission4.stage === 'fail') && mission4.penned < 3) mev(13);
  mission4.stage = 'idle';
  m4Npcs.forEach(function(g){ scene.remove(g); });
  m4Npcs.length = 0;
  m4Horses.forEach(function(h){ scene.remove(h.g); });
  m4Horses.length = 0;
  if (m4PenRing) m4PenRing.visible = false;
}
function m4Fail(){
  mission4.stage = 'fail'; mission4.tStage = 0;
  caption('THE TRAINER', 'THE AUCTION STARTED WITHOUT THEM. THE HORSES HAVE UNIONIZED.', 4600);
}
function m4ActiveHorse(){
  for (var k = 0; k < m4Horses.length; k++)
    if (m4Horses[k].state === 'follow' || m4Horses[k].state === 'riding') return m4Horses[k];
  return null;
}
function calmableHorse(){
  if (mission4.stage !== 'wrangle') return null;
  for (var k = 0; k < m4Horses.length; k++){
    var h = m4Horses[k];
    if (h.state !== 'wild') continue;
    var d = Math.hypot(h.g.position.x - player.x, h.g.position.z - player.z);
    if (d < 8) return h;   // F5: wider grab radius (was 5.5)
  }
  return null;
}
function calmHorse(h){
  if (m4ActiveHorse()){
    caption('THE TRAINER', 'ONE HORSE AT A TIME. THAT IS THE LAW.', 3200);
    return;
  }
  h.state = 'follow';
  sndTone(620, 0.15, 0, 'triangle', 0.14);
  caption('THE TRAINER', h.name + ' RESPECTS YOU NOW. HE\'LL FOLLOW. GET HIM TO ELMENDORF.', 4200);
}
function inPen(x, z){
  return x > M4_PEN.x0 && x < M4_PEN.x1 && z > M4_PEN.z0 && z < M4_PEN.z1;
}
function updateHorse(h, dt, now){
  var g = h.g;
  if (h.state === 'penned') return;
  if (h.state === 'riding'){
    var v = player.veh;
    if (!v){ h.state = 'follow'; return; }
    g.position.set(v.g.position.x, v.g.position.y + 1.15, v.g.position.z);
    g.rotation.y = v.th + Math.PI / 2;
    g.scale.setScalar(0.8);
    // close enough to the farm: he gets out and jumps the fence
    if (Math.hypot(v.g.position.x - (-228), v.g.position.z - (-1180)) < 45 || inPen(v.g.position.x, v.g.position.z)){
      h.state = 'trot'; g.scale.setScalar(1);
      caption('THE TRAINER', h.name + ' IS OUT OF THE CAR. HE JUMPS THE FENCE. SHOW-OFF.', 4000);
    }
    return;
  }
  if (h.state === 'trot'){
    g.position.y = groundY(g.position.x, g.position.z) + 0.05 + Math.abs(Math.sin(now * 0.012)) * 0.3;
    if (npcWalk(g, M4_PEN_T.x + h.i * 14, M4_PEN_T.z + h.i * 8, 9, dt)){
      h.state = 'penned';
      mission4.penned++;
      sndTone(880, 0.25, 0, 'square', 0.14);
      caption('THE TRAINER', mission4.penned + '/3 HOME. ' +
        (mission4.penned < 3 ? 'HE IMMEDIATELY PRETENDS NOTHING HAPPENED.' : 'THAT\'S ALL OF THEM.'), 3800);
    }
    return;
  }
  if (h.state === 'follow'){
    if (player.heli){
      if (!h.heliCap){ h.heliCap = true; caption('THE TRAINER', h.name + ' DOES NOT DO HELICOPTERS. HE\'LL WAIT.', 3600); }
      return;
    }
    h.heliCap = false;
    if (player.veh){
      h.state = 'riding';
      caption('THE TRAINER', h.name + ' GETS IN THE CAR. THIS IS FINE. THIS IS NORMAL.', 4000);
      return;
    }
    var d = Math.hypot(player.x - g.position.x, player.z - g.position.z);
    if (d > 3){
      var p = {x: g.position.x, z: g.position.z};
      var step = Math.min(d - 2.8, 11 * dt);   // F5: follow keeps pace with a jog (was 7)
      p.x += (player.x - g.position.x) / d * step;
      p.z += (player.z - g.position.z) / d * step;
      collide(p, 0.8, 0);
      g.position.x = p.x; g.position.z = p.z;
      g.rotation.y = Math.atan2(player.x - g.position.x, player.z - g.position.z);
    }
    g.position.y = groundY(g.position.x, g.position.z) + 0.05 +
      (d > 3.5 ? Math.abs(Math.sin(now * 0.011)) * 0.25 : 0);
    if (inPen(g.position.x, g.position.z)){ h.state = 'trot'; }
    return;
  }
  if (h.state === 'bolt'){
    h.boltT += dt;
    var f = Math.min(1, h.boltT / 2.2);
    var e = f * (2 - f);   // ease-out
    var p2 = {x: h.bx0 + (h.bx1 - h.bx0) * e, z: h.bz0 + (h.bz1 - h.bz0) * e};
    collide(p2, 0.8, 0);
    g.position.x = p2.x; g.position.z = p2.z;
    g.position.y = groundY(p2.x, p2.z) + 0.05 + Math.abs(Math.sin(now * 0.016)) * 0.5;
    g.rotation.y = Math.atan2(h.bx1 - h.bx0, h.bz1 - h.bz0);
    if (h.boltT > 2.3){ h.state = 'wild'; }
    return;
  }
  // wild: graze in place, bolt only if genuinely rushed. Walking (7.5) and a
  // jog stay safe; a shift-sprint (13.5), jetpack, or a moving car within 10m
  // spooks him, and he bolts a short 24-40m (F5: gentler after prod telemetry).
  g.position.y = groundY(g.position.x, g.position.z) + 0.05 + Math.sin(now * 0.002 + h.i) * 0.04;
  var pd = Math.hypot(player.x - g.position.x, player.z - g.position.z);
  var rushing = (!player.veh && playerSpeed() > 12) || (player.veh && Math.abs(player.veh.spd) > 3) ||
                (player.scoot && Math.abs(player.scoot.spd) > 3);   // a scooter spooks like a car, not a walker
  if (pd < 10 && rushing){
    var ang = Math.atan2(g.position.x - player.x, g.position.z - player.z) + (Math.random() - 0.5) * 1.2;
    var dist = 24 + Math.random() * 16;
    h.state = 'bolt'; h.boltT = 0; mev(11);   // spook beacon
    h.bx0 = g.position.x; h.bz0 = g.position.z;
    h.bx1 = Math.max(X0 + 20, Math.min(X1 - 20, g.position.x + Math.sin(ang) * dist));
    h.bz1 = Math.max(Z0 + 20, Math.min(Z1 - 20, g.position.z + Math.cos(ang) * dist));
    caption('THE HORSE', M4_NOPE[(Math.random() * M4_NOPE.length) | 0], 2400);
  }
}
var M4_AMBIENT = [
  ['THE TRAINER', 'WALK. UP. SLOW. IF YOU RUN AT A HORSE, THE HORSE WINS. THAT\'S JUST MATH.'],
  ['RADIO', 'CALLER REPORTS A HORSE IN A SEDAN ON LIMESTONE. CALLER HAS BEEN DRINKING, PROBABLY.'],
  ['THE TRAINER', 'THE AUCTIONEER IS STALLING. HE\'S DESCRIBING THE WEATHER.'],
  ['RADIO', 'AUCTION UPDATE: STILL NO HORSES. CROWD DOING THE WAVE TO PASS TIME.']
];
function updateMission4(dt){
  if (m4Ring){
    m4Ring.visible = allIdle();
    if (m4Ring.visible) m4Ring.rotation.z += dt * 0.8;
  }
  if (m4PenRing && m4PenRing.visible) m4PenRing.rotation.z += dt * 0.7;
  if (mission4.stage === 'idle') return;
  trackPlayerSpeed(dt);
  var now = performance.now();
  mission4.tStage += dt;
  var t = mission4.tStage;
  m4Horses.forEach(function(h){ updateHorse(h, dt, now); });
  if (mission4.stage === 'brief'){
    if (t > 6.6 && mission4.capIdx === 0){ mission4.capIdx = 1; caption('THE TRAINER', 'ONE OF THEM IS IN THIS PARK. PRETENDING TO BE A STATUE. HE\'S BEEN AT IT FOR HOURS.', 4800); }
    if (t > 13.6 && mission4.capIdx === 1){ mission4.capIdx = 2; caption('THE TRAINER', 'ONE\'S TAILGATING AT THE KROGER FIELD LOTS. SEASON HASN\'T STARTED. ONE\'S EATING THE FLOWERS AT CHEVY CHASE.', 5200); }
    if (t > 22.4 && mission4.capIdx === 2){ mission4.capIdx = 3; caption('THE TRAINER', 'SNEAK UP. PRESS E FOR THE LEAD ROPE. A CALM HORSE FOLLOWS YOU — CAR, WHATEVER, HE\'S FLEXIBLE. ELMENDORF PADDOCK. GO.', 5600); }
    if (t > 31.6){
      mission4.stage = 'wrangle'; mission4.tStage = 0; mission4.capAt = 24;
      mission4.t0 = now;
      M4_SPOTS.forEach(function(s, i){
        var g = makeLiveHorse(s.col);
        g.position.set(s.x, groundY(s.x, s.z) + 0.05, s.z);
        g.rotation.y = Math.random() * Math.PI * 2;
        m4Horses.push({g: g, state: 'wild', i: i, name: s.name, boltT: 0});
      });
      m4PenRing.visible = true;
      caption('DISPATCH', 'CLOCK STARTED. THREE HORSES. THE GREEN RING AT ELMENDORF IS HOME.', 4400);
    }
    return;
  }
  if (mission4.stage === 'wrangle'){
    if ((now - mission4.t0) / 1000 > 900){ m4Fail(); return; }
    if (t > mission4.capAt){
      mission4.capAt = t + 20 + Math.random() * 10;
      var c = M4_AMBIENT[(Math.random() * M4_AMBIENT.length) | 0];
      caption(c[0], c[1]);
    }
    if (mission4.penned >= 3){
      mission4.ms = now - mission4.t0;
      mission4.stage = 'won'; mission4.tStage = 0; mission4.capIdx = 0;
      sndWin(); sndApplause();
      caption('THE TRAINER', 'ALL THREE. BEFORE POST TIME. DO NOT TELL ANYONE ABOUT THE STATUE THING.', 4600);
      try {
        if (!m4Best || mission4.ms < m4Best){
          m4Best = mission4.ms;
          localStorage.setItem('lt_m4_best', String(Math.round(mission4.ms)));
        }
      } catch (e){}
      sendScore({t: 'score', ms: Math.round(mission4.ms), m: 4});
      mev(12);   // funnel: mission win
    }
    return;
  }
  if (mission4.stage === 'won'){
    if (t > 6.8 && mission4.capIdx === 0){
      mission4.capIdx = 1;
      caption('RADIO', 'AUCTION UPDATE: ALL HORSES PRESENT. ONE SMELLS LIKE FLOWERS. ONE INSISTS HE IS A STATUE.', 5000);
      showScores(mission4.ms, 4);
      mission4.stage = 'post'; mission4.tStage = 0;
    }
    return;
  }
  if (mission4.stage === 'fail'){ if (t > 5) m4Cleanup(); return; }
  if (mission4.stage === 'post'){ if (t > 22) m4Cleanup(); }
}

// ---------- mission 5: DEADLINE ----------
// NEWS 630 "THE BLOCK" needs footage for the six o'clock. Steal the news car
// at the newsroom ring on Main and drive five downtown checkpoints against a
// 180s clock. A checkpoint only banks while you're IN a car (on foot the ring
// shows but doesn't count) so it reads as a driving mission. The route flows
// with the one-way grid (Main is eastbound; High/MLK/Broadway are two-way).
// Declared here — before the labels.push block below runs — so M5_TRIG exists
// when that top-level statement reads M5_TRIG.x (statement order matters).
var M5_TRIG = {x: 60, z: 14};                       // Main St south sidewalk, THE BLOCK newsroom
var M5_CPS = [
  {x: 200, z: 0,    name: 'THOROUGHBRED PARK'},     // MLK & Main
  {x: 200, z: 200,  name: 'MLK AND HIGH'},          // MLK & High
  {x: -200, z: 200, name: 'RUPP ARENA'},            // Broadway & High
  {x: 0,   z: 0,    name: 'CHEAPSIDE COURTHOUSE'},  // Main & Upper
  {x: 60,  z: 0,    name: 'THE BLOCK - WRAP'}       // finish on Main by the newsroom
];
var M5_BUDGET = 180;                                // seconds on the clock
var m5Best = 0;
try { m5Best = parseInt(localStorage.getItem('lt_m5_best') || '0', 10) || 0; } catch (e){}
var mission5 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, cur: 0, capIdx: 0};
var m5Rings = [], m5Trig = null;
(function(){
  m5Trig = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0xffd400, transparent: true, opacity: 0.85}));
  m5Trig.rotation.x = Math.PI / 2;
  m5Trig.position.set(M5_TRIG.x, 0.9, M5_TRIG.z);
  scene.add(m5Trig);
  M5_CPS.forEach(function(cp){
    var ring = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.12, 6, 28),
      new THREE.MeshBasicMaterial({color: 0xffd400, transparent: true, opacity: 0.7}));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cp.x, 1.2, cp.z);
    ring.visible = false;
    scene.add(ring);
    m5Rings.push(ring);
  });
})();
function nearM5Trig(){
  var dx = player.x - M5_TRIG.x, dz = player.z - M5_TRIG.z;
  return dx * dx + dz * dz < 16;
}
function startMission5(){
  mission5.stage = 'driving'; mission5.tStage = 0; mission5.capIdx = 0;
  mission5.cur = 0; mission5.ms = 0; mission5.t0 = performance.now();
  ghostRec = {samples: [], splits: []}; ghostDelta = null;   // always record (banks a new best)
  loadGhost();   // load the best-run ghost for playback (if enabled + valid)
  caption('THE BLOCK', 'THE BLOCK NEEDS ART FOR THE SIX O CLOCK. GRAB A CAR AND GET ME THESE FIVE SHOTS.', 5200);
  addChatLine('* MISSION', 'DEADLINE - drive five downtown checkpoints before air', true);
}
function m5Cleanup(){
  mission5.stage = 'idle';
  for (var k = 0; k < m5Rings.length; k++) m5Rings[k].visible = false;
  hideGhost(); ghost = null; ghostRec = null; ghostDelta = null;
}
// ---------- Ghost Racers (F1): race your best DEADLINE run ----------
// A self-recorded replay that lives beside mission5 and NEVER enters `remotes`
// (never taggable, never counted in peerCount, never relayed). Recording is
// net-new: 10Hz {x,z,ry,m} samples in the driving branch (captures the on-foot
// dash to the news car too). On a best-beating win the buffer is quantized +
// base64'd to lt_m5_ghost with a CPS-hash+format header so a stale ghost is
// ignored. Playback time-lerps against the live clock (shared t0). Local only:
// nothing relays, the score submit is unchanged.
var GHOST_FMT = 1;                 // packing format version
var GHOST_TINT = 0xbfe8ff;         // cool cyan-white so it never reads as a real car
var ghostEnabled = true;
try { if (localStorage.getItem('lt_ghost') === '0') ghostEnabled = false; } catch (e){}
var ghostSeen = false;
try { ghostSeen = localStorage.getItem('lt_ghost_seen') === '1'; } catch (e){}
var ghost = null;        // {samples:[{x,z,ry,m}], splits:[ms], dur} or null
var ghostRec = null;     // in-run recording buffer {samples, splits} or null
var ghostDelta = null;   // seconds vs BEST at the last banked checkpoint (<=0 ahead)
var ghostPulseUntil = 0, ghostPulseAhead = false;
var _ghostMeshes = null;
// checkpoint fingerprint (+ format version): a checkpoint or format change
// invalidates old ghosts so a ghost never plays against a course it didn't run
function m5CpsHash(){
  // world extents join the hash: qX/uX bake X0..Z1 into the fixed-point
  // encoding, so a map growth must invalidate old ghosts, not distort them
  var s = GHOST_FMT + ':' + X0 + ',' + X1 + ',' + Z0 + ',' + Z1 + ':', h = 2166136261;
  for (var k = 0; k < M5_CPS.length; k++) s += M5_CPS[k].x + ',' + M5_CPS[k].z + ';';
  for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h & 0xffff;
}
function qX(x){ var v = Math.round((x - X0) / (X1 - X0) * 65535); return v < 0 ? 0 : v > 65535 ? 65535 : v; }
function uX(v){ return X0 + v / 65535 * (X1 - X0); }
function qZ(z){ var v = Math.round((z - Z0) / (Z1 - Z0) * 65535); return v < 0 ? 0 : v > 65535 ? 65535 : v; }
function uZ(v){ return Z0 + v / 65535 * (Z1 - Z0); }
function qRy(ry){ var a = ((ry % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); return Math.round(a / (Math.PI * 2) * 255) & 255; }
function uRy(b){ return b / 255 * (Math.PI * 2); }
function packGhost(rec){
  var nsp = rec.splits.length, hash = m5CpsHash(), out = [];
  out.push(GHOST_FMT & 255, (hash >> 8) & 255, hash & 255, nsp & 255);
  for (var s = 0; s < nsp; s++){
    var cs = Math.round(rec.splits[s] / 10); if (cs > 65535) cs = 65535; if (cs < 0) cs = 0;
    out.push((cs >> 8) & 255, cs & 255);
  }
  for (var i = 0; i < rec.samples.length; i++){
    var p = rec.samples[i], x = qX(p.x), z = qZ(p.z);
    out.push((x >> 8) & 255, x & 255, (z >> 8) & 255, z & 255, qRy(p.ry), p.m & 255);
  }
  var str = '';
  for (var b = 0; b < out.length; b++) str += String.fromCharCode(out[b]);
  return btoa(str);
}
function unpackGhost(b64){
  var str = atob(b64), len = str.length;
  if (len < 4) return null;
  if (str.charCodeAt(0) !== GHOST_FMT) return null;
  if ((((str.charCodeAt(1) << 8) | str.charCodeAt(2)) & 0xffff) !== m5CpsHash()) return null;
  var nsp = str.charCodeAt(3);
  if (nsp !== M5_CPS.length) return null;
  var off = 4, splits = [];
  for (var s = 0; s < nsp; s++){ splits.push(((str.charCodeAt(off) << 8) | str.charCodeAt(off + 1)) * 10); off += 2; }
  var rem = len - off;
  if (rem <= 0 || rem % 6 !== 0) return null;
  var n = rem / 6, samples = [];
  for (var i = 0; i < n; i++){
    var x = (str.charCodeAt(off) << 8) | str.charCodeAt(off + 1);
    var z = (str.charCodeAt(off + 2) << 8) | str.charCodeAt(off + 3);
    samples.push({x: uX(x), z: uZ(z), ry: uRy(str.charCodeAt(off + 4)), m: str.charCodeAt(off + 5)});
    off += 6;
  }
  return {samples: samples, splits: splits};
}
// force a built mesh translucent + ghost-tinted, cloning every material so we
// never mutate the SHARED cabMat/headMat/tailMat (that would ghost every car)
function ghostMat(src){
  var m = src.clone();
  m.transparent = true; m.opacity = 0.35; m.depthWrite = false;
  if (m.color) m.color.setHex(GHOST_TINT);
  if (m.emissive) m.emissive.setHex(0x162e38);   // faint self-glow, kills the bright head/taillight
  return m;
}
function ghostify(root){
  root.traverse(function(o){
    if (!o.material) return;
    if (o.material.length){ for (var i = 0; i < o.material.length; i++) o.material[i] = ghostMat(o.material[i]); }
    else o.material = ghostMat(o.material);
  });
}
function ensureGhostMeshes(){
  if (_ghostMeshes) return _ghostMeshes;
  var car = buildRemoteCar(GHOST_TINT); ghostify(car); car.visible = false;
  var av = makeAvatar(GHOST_TINT, GHOST_TINT); ghostify(av.g); av.g.visible = false;
  _ghostMeshes = {car: car, av: av};
  return _ghostMeshes;
}
function hideGhost(){ if (_ghostMeshes){ _ghostMeshes.car.visible = false; _ghostMeshes.av.g.visible = false; } }
function loadGhost(){
  ghost = null;
  if (!ghostEnabled) return;
  var raw = null;
  try { raw = localStorage.getItem('lt_m5_ghost'); } catch (e){ return; }
  if (!raw) return;
  var data = null;
  try { data = unpackGhost(raw); } catch (e){ data = null; }   // corrupt/stale -> ignored, no ghost
  if (!data || data.samples.length < 2) return;
  ghost = {samples: data.samples, splits: data.splits, dur: (data.samples.length - 1) * 0.1};
  ensureGhostMeshes();
  if (!ghostSeen){   // one-shot discovery, AFTER the brief's 7s caption window
    ghostSeen = true;
    try { localStorage.setItem('lt_ghost_seen', '1'); } catch (e){}
    // caption() is single-slot — firing inside the brief's computed 7s
    // display window would clobber it 4.5s early (review catch)
    setTimeout(function(){ if (mission5.stage === 'driving') caption('DISPATCH', 'YOUR BEST RUN RIDES WITH YOU', 3600); }, 7600);
  }
}
function updateGhost(){
  if (mission5.stage !== 'driving' || !ghost || !ghostEnabled){ hideGhost(); return; }
  var m = ensureGhostMeshes(), sm = ghost.samples;
  var fi = ((performance.now() - mission5.t0) / 1000) / 0.1;
  var i0 = Math.floor(fi), frac = fi - i0;
  if (i0 >= sm.length - 1){ i0 = sm.length - 1; frac = 0; }   // slower than the ghost: it parks at the end
  var a = sm[i0], b = sm[Math.min(i0 + 1, sm.length - 1)];
  var gx = a.x + (b.x - a.x) * frac, gz = a.z + (b.z - a.z) * frac;
  var gry = a.ry + angDelta(a.ry, b.ry) * frac;
  if (a.m === 2){
    m.car.visible = true; m.av.g.visible = false;
    m.car.position.set(gx, groundY(gx, gz) + 0.15, gz); m.car.rotation.y = gry;
  } else {
    m.av.g.visible = true; m.car.visible = false;
    m.av.g.position.set(gx, groundY(gx, gz), gz); m.av.g.rotation.y = gry;
  }
}
function updateMission5(dt){
  if (m5Trig){
    m5Trig.visible = allIdle();
    if (m5Trig.visible) m5Trig.rotation.z += dt * 0.8;
  }
  if (mission5.stage === 'idle') return;
  var now = performance.now();
  mission5.tStage += dt;
  var t = mission5.tStage;
  updateGhost();   // play/park/hide the best-run replay (also hides it off the driving stages)
  if (mission5.stage === 'driving'){
    // record the run at a steady 10Hz keyed on elapsed time (so sample i == i*0.1s
    // even through a frame hitch); captures the on-foot dash + the drive
    if (ghostRec){
      var idx = Math.floor((now - mission5.t0) / 100);
      while (ghostRec.samples.length <= idx && ghostRec.samples.length < 3000)
        ghostRec.samples.push({x: player.x, z: player.z, ry: player.ry, m: player.veh ? 2 : 0});
    }
    // only the current checkpoint ring is lit; it spins slowly
    for (var k = 0; k < m5Rings.length; k++){
      var on = k === mission5.cur;
      m5Rings[k].visible = on;
      if (on) m5Rings[k].rotation.z += dt * 0.9;
    }
    // clock expiry: fail, hide rings, no submit; back to idle after a beat
    if ((now - mission5.t0) / 1000 > M5_BUDGET){
      mission5.stage = 'fail'; mission5.tStage = 0;
      for (var f = 0; f < m5Rings.length; f++) m5Rings[f].visible = false;
      ghostRec = null;   // discard the in-progress recording; the saved best ghost is untouched
      caption('THE BLOCK', 'AND WE ARE OUT OF TIME. DEAD AIR. THE WORST AIR.', 4600);
      return;
    }
    // bank the current checkpoint ONLY while driving a car within ~7m
    if (player.veh){
      var cp = M5_CPS[mission5.cur];
      if (Math.hypot(cp.x - player.x, cp.z - player.z) < 7){
        mission5.cur++;
        if (ghostRec) ghostRec.splits.push(now - mission5.t0);   // this checkpoint's split time
        if (ghost && ghostEnabled && ghost.splits.length >= mission5.cur){
          ghostDelta = ((now - mission5.t0) - ghost.splits[mission5.cur - 1]) / 1000;   // <=0 = ahead of BEST
          ghostPulseUntil = now + 1400; ghostPulseAhead = ghostDelta <= 0;
        }
        if (mission5.cur >= M5_CPS.length){
          mission5.ms = now - mission5.t0;
          mission5.stage = 'won'; mission5.tStage = 0; mission5.capIdx = 0;
          for (var w = 0; w < m5Rings.length; w++) m5Rings[w].visible = false;
          sndWin(); sndApplause();
          caption('THE BLOCK', 'THAT IS OUR SIX O CLOCK. WELCOME TO THE BIG TIME.', 4600);
          try {
            if (!m5Best || mission5.ms < m5Best){
              m5Best = mission5.ms;
              localStorage.setItem('lt_m5_best', String(Math.round(mission5.ms)));
              // a best-beating win banks this run as the next ghost (non-improving win keeps the old one)
              if (ghostRec && ghostRec.samples.length) localStorage.setItem('lt_m5_ghost', packGhost(ghostRec));
            }
          } catch (e){}
          ghostRec = null;
          sendScore({t: 'score', ms: Math.round(mission5.ms), m: 5});
        } else {
          sndTone(880, 0.18, 0, 'square', 0.14);
          caption('THE BLOCK', 'GOT IT. NEXT: ' + M5_CPS[mission5.cur].name + '.', 3200);
        }
      }
    }
    return;
  }
  if (mission5.stage === 'won'){
    if (t > 5.4 && mission5.capIdx === 0){
      mission5.capIdx = 1;
      caption('RADIO', 'NEWS 630 THE BLOCK LEADS AT SIX WITH FIVE FRESH SHOTS FROM DOWNTOWN.', 5000);
      showScores(mission5.ms, 5);
      mission5.stage = 'post'; mission5.tStage = 0;
    }
    return;
  }
  if (mission5.stage === 'fail'){ if (t > 5) m5Cleanup(); return; }
  if (mission5.stage === 'post'){ if (t > 22) m5Cleanup(); }
}

// ---------- MISSION 6: THE MELT (pink ring, W Main by the Distillery District) ----------
// Ripped from the headlines: Crank & Boom is Lexington's shop in The64.com's
// fan-voted America's Best Ice Cream bracket (opens July 16) — up against TWO
// Louisville shops. The voters can't vote for what they haven't tasted, so
// the sample cooler rides with you. The clock IS the melt; a crash sloshes
// the cooler and melts it faster. Stops only bank from a car, like m5.
var M6_TRIG = {x: -460, z: -14};   // W Main north sidewalk, at the stand
var M6_CPS = [
  {x: -200, z: 0,   name: 'RUPP ARENA - MAIN & BROADWAY'},
  {x: 0,    z: 0,   name: 'CHEAPSIDE - THE JUDGES'},
  {x: 100,  z: 200, name: 'LIME & HIGH'},
  {x: 100,  z: 480, name: 'UK CAMPUS - THE STUDENT VOTE'},
  {x: 400,  z: 400, name: 'EUCLID & WOODLAND - BLOCK PARTY'}
];
var M6_BUDGET = 240;   // total melt seconds on the cooler
var M6_SLOSH = 20;     // each crash melts this many extra seconds
var m6Best = 0;
try { m6Best = parseInt(localStorage.getItem('lt_m6_best') || '0', 10) || 0; } catch (e){}
var mission6 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, cur: 0, slosh: 0,
                prevSpd: 0, sloshAt: 0, capIdx: 0};
var m6Rings = [], m6Trig = null, m6Cooler = null;
(function(){
  // the Crank & Boom stand — cream base, pink canopy, a scoop on the roof
  var base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.7, 1.6),
    new THREE.MeshStandardMaterial({color: 0xfff1e4, roughness: 0.85}));
  base.position.set(M6_TRIG.x, 0.85, -20); base.castShadow = true; scene.add(base);
  var canopy = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.2, 2.6),
    new THREE.MeshStandardMaterial({color: 0xff6fa5, roughness: 0.7}));
  canopy.position.set(M6_TRIG.x, 2.75, -20); canopy.castShadow = true; scene.add(canopy);
  var cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10),
    new THREE.MeshStandardMaterial({color: 0xc8913f, roughness: 0.9}));
  cone.rotation.x = Math.PI;
  cone.position.set(M6_TRIG.x, 3.55, -20); scene.add(cone);
  var scoop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8),
    new THREE.MeshStandardMaterial({color: 0xff9ec1, roughness: 0.8}));
  scoop.position.set(M6_TRIG.x, 4.35, -20); scene.add(scoop);
  colliders.push({x0: M6_TRIG.x - 1.9, x1: M6_TRIG.x + 1.9, z0: -21.3, z1: -18.7, h: 2.9});
  labels.push({name: 'CRANK & BOOM', x: M6_TRIG.x, y: 7, z: -20});
  labels.push({name: 'DISTILLERY DISTRICT', x: -520, y: 13, z: -60});
  // the cooler rides on your back for the whole run
  m6Cooler = new THREE.Group();
  var tub = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.34),
    new THREE.MeshStandardMaterial({color: 0x2fa8bd, roughness: 0.8}));
  var lid = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.38),
    new THREE.MeshStandardMaterial({color: 0xf2f7f7, roughness: 0.7}));
  lid.position.y = 0.26;
  m6Cooler.add(tub); m6Cooler.add(lid);
  m6Cooler.position.set(0, 1.12, -0.34);
  m6Cooler.visible = false;
  player.av.g.add(m6Cooler);
  m6Trig = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0xff6fa5, transparent: true, opacity: 0.85}));
  m6Trig.rotation.x = Math.PI / 2;
  m6Trig.position.set(M6_TRIG.x, 0.9, M6_TRIG.z);
  scene.add(m6Trig);
  M6_CPS.forEach(function(cp){
    var ring = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.12, 6, 28),
      new THREE.MeshBasicMaterial({color: 0xff6fa5, transparent: true, opacity: 0.7}));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cp.x, 1.2, cp.z);
    ring.visible = false;
    scene.add(ring);
    m6Rings.push(ring);
  });
})();
function nearM6Trig(){
  var dx = player.x - M6_TRIG.x, dz = player.z - M6_TRIG.z;
  return dx * dx + dz * dz < 16;
}
function m6MeltSec(){
  return (performance.now() - mission6.t0) / 1000 + mission6.slosh * M6_SLOSH;
}
var M6_SLOSH_LINES = [
  'THAT WAS A CURB. THE BOURBON BALL FELT THAT.',
  'IT IS SLOSHING. I CAN HEAR IT SLOSHING FROM HERE.',
  'ROCKY ROAD IS A FLAVOR, NOT A DRIVING STYLE.'
];
function startMission6(){
  mission6.stage = 'drive'; mission6.tStage = 0; mission6.capIdx = 0;
  mission6.cur = 0; mission6.ms = 0; mission6.slosh = 0;
  mission6.prevSpd = 0; mission6.sloshAt = 0;
  mission6.t0 = performance.now();
  if (m6Cooler) m6Cooler.visible = true;
  caption('CRANK & BOOM', 'THE64 BRACKET OPENS JULY 16 AND THE VOTERS HAVEN\'T TASTED A SPOONFUL. THE COOLER RIDES WITH YOU - GRAB A CAR.', 5400);
  addChatLine('* MISSION', 'THE MELT - five scoop stops before the cooler is soup', true);
}
function m6Cleanup(){
  mission6.stage = 'idle';
  if (m6Cooler) m6Cooler.visible = false;
  for (var k = 0; k < m6Rings.length; k++) m6Rings[k].visible = false;
}
function updateMission6(dt){
  if (m6Trig){
    m6Trig.visible = allIdle();
    if (m6Trig.visible) m6Trig.rotation.z += dt * 0.8;
  }
  if (mission6.stage === 'idle') return;
  var now = performance.now();
  mission6.tStage += dt;
  var t = mission6.tStage;
  if (mission6.stage === 'drive'){
    for (var k = 0; k < m6Rings.length; k++){
      var on = k === mission6.cur;
      m6Rings[k].visible = on;
      if (on) m6Rings[k].rotation.z += dt * 0.9;
    }
    if (t > 7 && mission6.capIdx === 0){ mission6.capIdx = 1; caption('CRANK & BOOM', 'LOUISVILLE HAS TWO SHOPS IN THIS BRACKET. LEXINGTON HAS US. NO PRESSURE.', 4600); }
    // a collision chops car speed in a single frame (the 0.2x crunch in
    // updateDrive); braking never does — that one-frame cliff IS the slosh
    if (player.veh){
      var as = Math.abs(player.veh.spd);
      var drop = mission6.prevSpd - as;
      if (drop > 4 && drop > mission6.prevSpd * 0.5 && t > mission6.sloshAt){
        mission6.sloshAt = t + 1.2;
        mission6.slosh++;
        sndTone(140, 0.3, 0, 'sawtooth', 0.22);
        caption('CRANK & BOOM', M6_SLOSH_LINES[(mission6.slosh - 1) % M6_SLOSH_LINES.length], 3600);
      }
      mission6.prevSpd = as;
    } else mission6.prevSpd = 0;
    if (m6MeltSec() > M6_BUDGET){
      mission6.stage = 'fail'; mission6.tStage = 0;
      for (var f = 0; f < m6Rings.length; f++) m6Rings[f].visible = false;
      if (m6Cooler) m6Cooler.visible = false;
      caption('CRANK & BOOM', 'IT\'S SOUP. YOU DELIVERED SOUP. THE BRACKET VOTES JULY 16 AND WE ARE BRINGING SOUP.', 5000);
      return;
    }
    // bank the current stop ONLY while driving a car within ~7m
    if (player.veh){
      var cp = M6_CPS[mission6.cur];
      if (Math.hypot(cp.x - player.x, cp.z - player.z) < 7){
        mission6.cur++;
        if (mission6.cur >= M6_CPS.length){
          mission6.ms = (now - mission6.t0) + mission6.slosh * M6_SLOSH * 1000;
          mission6.stage = 'won'; mission6.tStage = 0; mission6.capIdx = 0;
          for (var w = 0; w < m6Rings.length; w++) m6Rings[w].visible = false;
          if (m6Cooler) m6Cooler.visible = false;
          sndWin(); sndApplause();
          caption('CRANK & BOOM', 'FIVE STOPS AND STILL FROZEN. THE BRACKET IS OURS. TELL LOUISVILLE.', 4800);
          try {
            if (!m6Best || mission6.ms < m6Best){
              m6Best = mission6.ms;
              localStorage.setItem('lt_m6_best', String(Math.round(mission6.ms)));
            }
          } catch (e){}
          sendScore({t: 'score', ms: Math.round(mission6.ms), m: 6});
        } else {
          sndTone(880, 0.18, 0, 'square', 0.14);
          caption('CRANK & BOOM', 'SCOOPS AWAY. NEXT: ' + M6_CPS[mission6.cur].name + '.', 3200);
        }
      }
    }
    return;
  }
  if (mission6.stage === 'won'){
    if (t > 5.4 && mission6.capIdx === 0){
      mission6.capIdx = 1;
      caption('RADIO', 'NEWS 630 A LEXINGTON CREAMERY\'S TOURNAMENT SAMPLES CROSSED TOWN AT SPEED TODAY. WITNESSES DESCRIBE THE DRIVING AS QUOTE SOFT SERVE.', 5400);
      showScores(mission6.ms, 6);
      mission6.stage = 'post'; mission6.tStage = 0;
    }
    return;
  }
  if (mission6.stage === 'fail'){ if (t > 5) m6Cleanup(); return; }
  if (mission6.stage === 'post'){ if (t > 22) m6Cleanup(); }
}

// ---------- MISSION 7: TAILGATE COMPLIANCE (blue ring, Kroger Field lots) ----------
// Also ripped from the headlines: UK Athletics' new tailgating guidelines —
// setup doesn't begin until August 8, every structure gets tagged with the
// owner's contact info, and no deep ground stakes near tree roots. Eight
// canopies just appeared in the Kroger Field lots. In July. Compliance is
// done on foot, with a clipboard.
var M7_TRIG = {x: -190, z: 542};
var M7_TENTS = [   // stakes: deep-ground-stake offenders take a 2s pull
  {x: -285, z: 485}, {x: -252, z: 522, stakes: 1}, {x: -205, z: 478},
  {x: -150, z: 512}, {x: -98, z: 484, red: 1},
  {x: -18, z: 452}, {x: 24, z: 507, stakes: 1}, {x: 48, z: 436}
];
var M7_BUDGET = 240;   // seconds to kickoff
var m7Best = 0;
try { m7Best = parseInt(localStorage.getItem('lt_m7_best') || '0', 10) || 0; } catch (e){}
var mission7 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, tagged: 0, capIdx: 0};
var m7Tents = [], m7Trig = null;
(function(){
  m7Trig = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0x2a6cff, transparent: true, opacity: 0.85}));
  m7Trig.rotation.x = Math.PI / 2;
  m7Trig.position.set(M7_TRIG.x, 0.9, M7_TRIG.z);
  scene.add(m7Trig);
  var legGeo = new THREE.BoxGeometry(0.12, 2.3, 0.12);
  var legMat = new THREE.MeshStandardMaterial({color: 0x8a8f96, roughness: 0.8});
  M7_TENTS.forEach(function(td){
    var g = new THREE.Group();
    var canopy = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, 3.2),
      new THREE.MeshStandardMaterial({color: td.red ? 0xc41e3a : 0x0033a0, roughness: 0.75}));
    canopy.position.y = 2.4; canopy.castShadow = true;
    g.add(canopy);
    [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].forEach(function(c){
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(c[0], 1.15, c[1]);
      g.add(leg);
    });
    g.position.set(td.x, 0, td.z);
    scene.add(g);
    m7Tents.push({g: g, canopy: canopy, x: td.x, z: td.z,
                  stakes: !!td.stakes, red: !!td.red, tagged: false, hold: 0});
  });
})();
function nearM7Trig(){
  var dx = player.x - M7_TRIG.x, dz = player.z - M7_TRIG.z;
  return dx * dx + dz * dz < 16;
}
function m7NextTent(){
  var best = null, bd = 1e12;
  for (var k = 0; k < m7Tents.length; k++){
    if (m7Tents[k].tagged) continue;
    var dx = m7Tents[k].x - player.x, dz = m7Tents[k].z - player.z;
    var d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = m7Tents[k]; }
  }
  return best;
}
var M7_TAG_LINES = [
  'TAGGED. OWNER CONTACT INFO: APPLIED.',
  'THIS ONE HAS A SMOKER AND A GENERATOR. AND NOW, A TAG.',
  'TAGGED. THE CORNHOLE BOARDS ARE A SEPARATE FORM.',
  'TAGGED. NICE CANOPY. SHAME ABOUT THE PAPERWORK.'
];
function startMission7(){
  mission7.stage = 'tag'; mission7.tStage = 0; mission7.capIdx = 0;
  mission7.tagged = 0; mission7.ms = 0;
  mission7.t0 = performance.now();
  for (var k = 0; k < m7Tents.length; k++){
    var tn = m7Tents[k];
    tn.tagged = false; tn.hold = 0;
    tn.canopy.material.color.setHex(tn.red ? 0xc41e3a : 0x0033a0);
  }
  caption('UK COMPLIANCE', 'NEW TAILGATE GUIDELINES: EVERY STRUCTURE TAGGED WITH OWNER CONTACT INFO. THESE EIGHT CANOPIES HAVE NOTHING.', 5200);
  addChatLine('* MISSION', 'TAILGATE COMPLIANCE - tag all 8 canopies before kickoff', true);
}
function m7Cleanup(){
  mission7.stage = 'idle';
}
function updateMission7(dt){
  if (m7Trig){
    m7Trig.visible = allIdle();
    if (m7Trig.visible) m7Trig.rotation.z += dt * 0.8;
  }
  if (mission7.stage === 'idle') return;
  var now = performance.now();
  mission7.tStage += dt;
  var t = mission7.tStage;
  if (mission7.stage === 'tag'){
    if (t > 6.4 && mission7.capIdx === 0){ mission7.capIdx = 1; caption('UK COMPLIANCE', 'SETUP DOES NOT BEGIN UNTIL AUGUST 8. IT IS JULY. AND YET.', 4400); }
    else if (t > 13 && mission7.capIdx === 1){ mission7.capIdx = 2; caption('UK COMPLIANCE', 'TWO OF THEM USED DEEP GROUND STAKES. NEAR TREE ROOTS. STAND THERE UNTIL THE STAKES COME OUT.', 5000); }
    if ((now - mission7.t0) / 1000 > M7_BUDGET){
      mission7.stage = 'fail'; mission7.tStage = 0;
      caption('UK COMPLIANCE', 'KICKOFF. THE LOT IS A LAWLESS CANVAS CITY. WE GET THEM NEXT SEASON.', 4800);
      return;
    }
    // tagging is on foot only — clipboards don't work from a car window.
    // linger 0.5s to tag; deep-stake tents take a 2s pull
    if (!player.veh && !isFrozen()){
      for (var k = 0; k < m7Tents.length; k++){
        var tn = m7Tents[k];
        if (tn.tagged) continue;
        var dx = tn.x - player.x, dz = tn.z - player.z;
        if (dx * dx + dz * dz > 6.8){ tn.hold = 0; continue; }
        tn.hold += dt;
        if (tn.hold >= (tn.stakes ? 2.0 : 0.5)){
          tn.tagged = true;
          mission7.tagged++;
          tn.canopy.material.color.setHex(0x1f8a4c);
          sndTone(1180, 0.12, 0, 'square', 0.16);
          if (mission7.tagged < m7Tents.length){
            caption('UK COMPLIANCE', tn.stakes ? 'STAKES OUT. THE TREE ROOTS SEND THEIR REGARDS.' :
              tn.red ? 'THIS ONE IS LOUISVILLE RED. TAG IT ANYWAY. THIS IS A JUDGMENT-FREE PARKING LOT.' :
              M7_TAG_LINES[mission7.tagged % M7_TAG_LINES.length], 3400);
          } else {
            mission7.ms = now - mission7.t0;
            mission7.stage = 'won'; mission7.tStage = 0; mission7.capIdx = 0;
            sndWin(); sndApplause();
            caption('UK COMPLIANCE', 'EIGHT FOR EIGHT. THE TAILGATE IS FULLY COMPLIANT. GO CATS.', 4600);
            try {
              if (!m7Best || mission7.ms < m7Best){
                m7Best = mission7.ms;
                localStorage.setItem('lt_m7_best', String(Math.round(mission7.ms)));
              }
            } catch (e){}
            sendScore({t: 'score', ms: Math.round(mission7.ms), m: 7});
            return;
          }
        }
      }
    }
    return;
  }
  if (mission7.stage === 'won'){
    if (t > 5.4 && mission7.capIdx === 0){
      mission7.capIdx = 1;
      caption('RADIO', '98.5 THE CAT KROGER FIELD\'S LOTS ARE ONE HUNDRED PERCENT TAGGED AND COMPLIANT. AUGUST 8 CANNOT COME SOON ENOUGH.', 5000);
      showScores(mission7.ms, 7);
      mission7.stage = 'post'; mission7.tStage = 0;
    }
    return;
  }
  if (mission7.stage === 'fail'){ if (t > 5) m7Cleanup(); return; }
  if (mission7.stage === 'post'){ if (t > 22) m7Cleanup(); }
}
// ---------- mission 8: LOOSE IN THE PADDOCK (freeze blaster + horse farms) ----------
// The night before the Keeneland yearling sale, three foals jumped the rail at
// Elmendorf. Settle each with a calming dart (the freeze blaster gets a job) and
// it trots itself to the central pen. Amber ring INSIDE the paddock = instant
// retry (the HORSEPOWER lesson). 180s budget, target 90-150s. On foot only.
// Top-level vars declared before the labels.push block below (statement order).
var M8_TRIG = {x: -430, z: -1300};
var M8_PEN = {x: -410, z: -1360};
var M8_BUDGET = 180;
var M8_SPOTS = [{x: -470, z: -1330}, {x: -390, z: -1440}, {x: -430, z: -1380}];
var m8Best = 0;
try { m8Best = parseInt(localStorage.getItem('lt_m8_best') || '0', 10) || 0; } catch (e){}
var mission8 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, penned: 0, capIdx: 0};
var m8Foals = [], m8Ring = null, m8PenRing = null;
(function(){
  m8Ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0xc8792e, transparent: true, opacity: 0.85}));   // amber (bay coat)
  m8Ring.rotation.x = Math.PI / 2;
  m8Ring.position.set(M8_TRIG.x, 0.9, M8_TRIG.z);
  scene.add(m8Ring);
  m8PenRing = new THREE.Mesh(new THREE.TorusGeometry(3, 0.12, 6, 28),
    new THREE.MeshBasicMaterial({color: 0xc8792e, transparent: true, opacity: 0.7}));
  m8PenRing.rotation.x = Math.PI / 2;
  m8PenRing.position.set(M8_PEN.x, 0.9, M8_PEN.z);
  m8PenRing.visible = false;
  scene.add(m8PenRing);
})();
function nearM8Trig(){
  var dx = player.x - M8_TRIG.x, dz = player.z - M8_TRIG.z;
  return dx * dx + dz * dz < 16;
}
function blasterMissionActive(){ return mission8.stage === 'wrangle'; }   // darts settle foals, no PvP opt-in
// a foal: makeLiveHorse scaled down, with the coat material exposed for the
// ice-blue settle shimmer.
function makeFoal(col){
  var g = new THREE.Group();
  var coat = new THREE.MeshStandardMaterial({color: col, roughness: 0.85});
  var body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.15, 1.05), coat);
  body.position.y = 1.85; body.castShadow = true; g.add(body);
  var neck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.65, 0.55), coat);
  neck.position.set(1.75, 2.5, 0); neck.rotation.z = 0.7; g.add(neck);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 0.48), coat);
  head.position.set(2.3, 3.0, 0); g.add(head);
  var tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.85, 0.16), coat);
  tail.position.set(-1.7, 1.45, 0); tail.rotation.z = 0.3; g.add(tail);
  for (var l = 0; l < 4; l++){
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.35, 0.24), coat);
    leg.position.set(l < 2 ? 1.15 : -1.15, 0.68, l % 2 ? 0.32 : -0.32);
    g.add(leg);
  }
  g.scale.setScalar(0.7);
  scene.add(g);
  return {g: g, coat: coat};
}
function startMission8(){
  mission8.stage = 'wrangle'; mission8.tStage = 0; mission8.capIdx = 0;
  mission8.penned = 0; mission8.ms = 0;
  mission8.t0 = performance.now();
  M8_SPOTS.forEach(function(s, i){
    var f = makeFoal([0x6e4a2e, 0x8a5a34, 0x4a3320][i % 3]);
    f.g.position.set(s.x, groundY(s.x, s.z) + 0.05, s.z);
    f.g.rotation.y = Math.random() * Math.PI * 2;
    f.state = 'loose'; f.i = i; f.name = ''; f.boltT = 0; f.calmAt = 0;
    m8Foals.push(f);
  });
  if (m8PenRing) m8PenRing.visible = true;
  player.av.gun.visible = true;   // issue the blaster WITHOUT opting into PvP
  // first-ever attempt leads with the lead-the-target coaching; once coached,
  // returning players get the flavor brief. One caption() call only.
  var m8Coached = true;
  try { m8Coached = localStorage.getItem('lt_m8_coached') === '1'; } catch (e){}
  if (!m8Coached){
    caption('THE FOREMAN', 'AIM AHEAD OF A MOVING FOAL - THE DART TAKES A BEAT TO GET THERE.', 4200);
    try { localStorage.setItem('lt_m8_coached', '1'); } catch (e){}
  } else {
    caption('THE FOREMAN', 'THREE FOALS JUMPED THE RAIL BEFORE THE SALE. SETTLE THEM WITH THE DART AND THEY WALK THEMSELVES TO THE PEN.', 5200);
  }
  addChatLine('* MISSION', 'LOOSE IN THE PADDOCK - settle 3 foals with the dart', true);
  mev(20);   // funnel: mission start
}
function m8Cleanup(){
  mission8.stage = 'idle';
  m8Foals.forEach(function(f){ scene.remove(f.g); });
  m8Foals.length = 0;
  if (m8PenRing) m8PenRing.visible = false;
  player.av.gun.visible = player.pvp;   // holster unless the player opted into PvP separately
}
function m8Fail(){
  mission8.stage = 'fail'; mission8.tStage = 0;
  caption('THE FOREMAN', 'THEY BOLTED FOR PARIS PIKE. RESET AND TRY AGAIN.', 4200);
  mev(23);   // funnel: fail/abandon (timeout)
}
function settleFoal(f){   // a mine dart struck a loose foal
  f.state = 'calm'; f.calmAt = performance.now();
  f.coat.emissive.setHex(0x9adfff);
  f.coat.emissiveIntensity = 0.35;
  puff(f.g.position.x, f.g.position.y + 1, f.g.position.z, 0x9adfff, 0.2, 1.3, 360, 0.4, 0.7);
  sndTone(720, 0.18, 0, 'triangle', 0.14);   // soft settle chime
}
function penFoal(f){
  f.state = 'penned';
  f.coat.emissiveIntensity = 0;
  mission8.penned++;
  sndTone(880, 0.25, 0, 'square', 0.14);
  if (mission8.penned === 1){ mev(21); caption('THE FOREMAN', 'ONE SETTLED - TWO STILL OUT.', 3400); }
  else if (mission8.penned === 2) caption('THE FOREMAN', 'TWO PENNED - ONE MORE.', 3400);
}
function updateFoal(f, dt, now){
  var g = f.g;
  if (f.state === 'penned') return;
  if (f.state === 'calm'){
    f.coat.emissiveIntensity = 0.35 + Math.sin(now * 0.02) * 0.15;   // ice shimmer
    if (now - f.calmAt > 8000){ f.state = 'loose'; f.coat.emissiveIntensity = 0; return; }   // calm lapsed: re-bolt
    if (npcWalk(g, M8_PEN.x + f.i * 3, M8_PEN.z + f.i * 3, 9, dt)) penFoal(f);
    return;
  }
  if (f.state === 'bolt'){
    f.boltT += dt;
    var e = Math.min(1, f.boltT / 2.2); e = e * (2 - e);   // ease-out
    var p2 = {x: f.bx0 + (f.bx1 - f.bx0) * e, z: f.bz0 + (f.bz1 - f.bz0) * e};
    collide(p2, 0.8, 0);
    g.position.x = p2.x; g.position.z = p2.z;
    g.position.y = groundY(p2.x, p2.z) + 0.05 + Math.abs(Math.sin(now * 0.016)) * 0.5;
    g.rotation.y = Math.atan2(f.bx1 - f.bx0, f.bz1 - f.bz0);
    if (f.boltT > 2.3){ f.state = 'loose'; }   // still dartable once it settles down
    return;
  }
  // loose: graze in place; bolt if rushed (F5-tuned spook: <10m, sprint 13.5 / car)
  g.position.y = groundY(g.position.x, g.position.z) + 0.05 + Math.sin(now * 0.002 + f.i) * 0.04;
  var pd = Math.hypot(player.x - g.position.x, player.z - g.position.z);
  var rushing = (!player.veh && playerSpeed() > 12) || (player.veh && Math.abs(player.veh.spd) > 3) ||
                (player.scoot && Math.abs(player.scoot.spd) > 3);   // a scooter spooks like a car, not a walker
  if (pd < 10 && rushing){
    var ang = Math.atan2(g.position.x - player.x, g.position.z - player.z) + (Math.random() - 0.5) * 1.2;
    var dist = 24 + Math.random() * 16;
    f.state = 'bolt'; f.boltT = 0;
    f.bx0 = g.position.x; f.bz0 = g.position.z;
    f.bx1 = Math.max(X0 + 20, Math.min(X1 - 20, g.position.x + Math.sin(ang) * dist));
    f.bz1 = Math.max(Z0 + 20, Math.min(Z1 - 20, g.position.z + Math.cos(ang) * dist));
  }
}
function updateMission8(dt){
  if (m8Ring){
    m8Ring.visible = allIdle();
    if (m8Ring.visible) m8Ring.rotation.z += dt * 0.8;
  }
  if (m8PenRing && m8PenRing.visible) m8PenRing.rotation.z += dt * 0.7;
  if (mission8.stage === 'idle') return;
  trackPlayerSpeed(dt);
  var now = performance.now();
  mission8.tStage += dt;
  var t = mission8.tStage;
  m8Foals.forEach(function(f){ updateFoal(f, dt, now); });
  if (mission8.stage === 'wrangle'){
    if ((now - mission8.t0) / 1000 > M8_BUDGET){ m8Fail(); return; }
    if (mission8.penned >= 3){
      mission8.ms = now - mission8.t0;
      mission8.stage = 'won'; mission8.tStage = 0; mission8.capIdx = 0;
      sndWin(); sndApplause();
      caption('THE FOREMAN', 'THAT IS ALL THREE, HOME BEFORE THE INSPECTORS. GOOD HANDS.', 4600);
      try {
        if (!m8Best || mission8.ms < m8Best){
          m8Best = mission8.ms;
          localStorage.setItem('lt_m8_best', String(Math.round(mission8.ms)));
        }
      } catch (e){}
      sendScore({t: 'score', ms: Math.round(mission8.ms), m: 8});   // NUMERIC 8
      mev(22);   // funnel: mission win
    }
    return;
  }
  if (mission8.stage === 'won'){
    if (t > 5 && mission8.capIdx === 0){
      mission8.capIdx = 1;
      showScores(mission8.ms, 8);
      mission8.stage = 'post'; mission8.tStage = 0;
    }
    return;
  }
  if (mission8.stage === 'fail'){ if (t > 5) m8Cleanup(); return; }
  if (mission8.stage === 'post'){ if (t > 20) m8Cleanup(); }
}
// ---------- mission 9: AIR MAIL (jetpack rooftop delivery run) ----------
// The street's a parking lot and the mail truck rolls at six, so the downtown
// postmaster straps you into the jetpack to run the day's airmail rooftop to
// rooftop. The course ALTERNATES violet air-rings (fly your body through) with
// rooftop PADS (land to bank the stop AND refuel — fuel only fills on the
// ground). It ESCALATES: a low hop, a low roof, a mid climb, the Central Bank
// Tower (h88, the FORCED refuel — you cannot reach Big Blue's h128 roof from the
// ground on one tank), then Big Blue itself. No engine change: air-rings are a
// 3D proximity test, pads are "grounded on the roof at the pad point" over the
// existing landable colliders. Fuel is UNTOUCHED — the stock 9/s burn + 30/s
// ground regen ARE the difficulty. A dry tank or a fall is a time cost, never a
// reset: banked stops persist and the current target stays lit; only the 180s
// clock fails you. Flown on foot -> jetpack (mode 1, a foot sub-state).
// Top-level vars declared before the labels.push block below (statement order).
var M9_TRIG = {x: 14, z: -9.5};
var M9_BUDGET = 180;
var M9_RING_COL = 0x9d4edd;   // violet — distinct from teal/green/pink/blue/amber/gold
// Ordered waypoints, alternating ring (fly-through) and pad (land+refuel),
// climbing the real downtown tower cluster. y = ring altitude / pad roof-top.
// Placed for a fuel rhythm where each leg is flyable on one tank and the
// Central Bank pad is a forced refuel before the final hop up to Big Blue.
var M9_WAY = [
  {x: -16,  z: 4,   y: 16,     pad: false, r: 7.5, label: 'LOW HOP'},        // fresh-user gate: one hold-Space hop
  {x: -50,  z: 42,  y: 12.35,  pad: true,  r: 13,  label: 'STOP 1'},         // big low roof (addTower -50,42,h12)
  {x: -92,  z: 56,  y: 52,     pad: false, r: 8,   label: 'MID GATE'},       // climbing toward the towers
  {x: -126, z: 72,  y: 88.35,  pad: true,  r: 11,  label: 'CENTRAL BANK'},   // addTower -126,72,h88 — forced refuel
  {x: -126, z: 52,  y: 112,    pad: false, r: 8,   label: 'THE GAP'},        // between the towers, near ceiling
  {x: -127, z: 32,  y: 128.35, pad: true,  r: 12,  label: 'BIG BLUE'}        // addTower -127,32,h128 — deliver, win
];
var m9Best = 0;
try { m9Best = parseInt(localStorage.getItem('lt_m9_best') || '0', 10) || 0; } catch (e){}
var mission9 = {stage: 'idle', tStage: 0, t0: 0, ms: 0, cur: 0, capIdx: 0, dry: false};
var m9StartRing = null, m9Meshes = [];
(function(){
  m9StartRing = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: M9_RING_COL, transparent: true, opacity: 0.85}));   // violet start ring
  m9StartRing.rotation.x = Math.PI / 2;
  m9StartRing.position.set(M9_TRIG.x, 0.9, M9_TRIG.z);
  scene.add(m9StartRing);
  M9_WAY.forEach(function(w){
    var mesh;
    if (w.pad){
      // a flat landing hoop lying on the roof surface — "set down here"
      mesh = new THREE.Mesh(new THREE.TorusGeometry(w.r * 0.62, 0.16, 8, 30),
        new THREE.MeshBasicMaterial({color: M9_RING_COL, transparent: true, opacity: 0.72}));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(w.x, w.y + 0.25, w.z);
    } else {
      // an air hoop you fly your body through. Detection is spherical, so the
      // flat orientation is cosmetic — it matches every other mission ring.
      mesh = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.16, 8, 28),
        new THREE.MeshBasicMaterial({color: M9_RING_COL, transparent: true, opacity: 0.85}));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(w.x, w.y, w.z);
    }
    mesh.visible = false;
    scene.add(mesh);
    m9Meshes.push(mesh);
  });
})();
function nearM9Trig(){
  var dx = player.x - M9_TRIG.x, dz = player.z - M9_TRIG.z;
  return dx * dx + dz * dz < 20;
}
function startMission9(){
  mission9.stage = 'flying'; mission9.tStage = 0; mission9.capIdx = 0;
  mission9.cur = 0; mission9.ms = 0; mission9.dry = false;
  mission9.t0 = performance.now();
  // first-ever attempt leads with the hold-Space coaching; once coached,
  // returning pilots get the postmaster's flavor brief. One caption() call (the
  // m8 pattern). Fuel is NOT force-set — the start is on foot on the ground, so
  // the stock 30/s ground regen tops the tank off in ~3s with zero fuel-model
  // touch (per the F7 "fuel is untouched" non-goal).
  var m9Coached = true;
  try { m9Coached = localStorage.getItem('lt_m9_coached') === '1'; } catch (e){}
  if (!m9Coached){
    caption('THE POSTMASTER', 'HOLD SPACE TO CLIMB, EASE OFF TO GLIDE. LAND ON A ROOF PAD TO TOP OFF THE TANK.', 5200);
    try { localStorage.setItem('lt_m9_coached', '1'); } catch (e){}
  } else {
    caption('THE POSTMASTER', 'STREET IS A PARKING LOT AND THE TRUCK ROLLS AT SIX. RUN THE MAIL ROOFTOP TO ROOFTOP - THE PADS ARE WHERE YOU CATCH YOUR BREATH, FUEL ONLY FILLS ON THE GROUND.', 6000);
  }
  addChatLine('* MISSION', 'AIR MAIL - fly the rooftop mail route, land on the pads to refuel', true);
  mev(30);   // funnel: mission start
}
function m9Cleanup(){
  mission9.stage = 'idle';
  for (var i = 0; i < m9Meshes.length; i++) m9Meshes[i].visible = false;
}
function m9Fail(){
  mission9.stage = 'fail'; mission9.tStage = 0;
  caption('THE POSTMASTER', 'THE CLOCK BEAT YOU - THE TRUCK LEFT WITHOUT THE BAG.', 4600);
  mev(33);   // funnel: fail (timeout)
}
function m9Reached(w){
  // pad = grounded on the roof at the pad point (the y-guard rejects the street
  // far below the same x,z); ring = body within the 3D catch radius (altitude
  // included). No physics added — pure position tests over existing rooftops.
  if (w.pad){
    var pdx = player.x - w.x, pdz = player.z - w.z;
    return player.grounded && (pdx * pdx + pdz * pdz) < w.r * w.r && player.y > w.y - 3;
  }
  var dx = player.x - w.x, dy = (player.y + 1) - w.y, dz = player.z - w.z;
  return (dx * dx + dy * dy + dz * dz) < w.r * w.r;
}
function updateMission9(dt){
  if (m9StartRing){
    m9StartRing.visible = allIdle();
    if (m9StartRing.visible) m9StartRing.rotation.z += dt * 0.8;
  }
  if (mission9.stage === 'idle') return;
  var now = performance.now();
  mission9.tStage += dt;
  var t = mission9.tStage;
  if (mission9.stage === 'flying'){
    // only the current waypoint is lit; the next lights on arrival
    for (var i = 0; i < m9Meshes.length; i++){
      var lit = (i === mission9.cur);
      m9Meshes[i].visible = lit;
      if (lit) m9Meshes[i].rotation.z += dt * 1.1;
    }
    if ((now - mission9.t0) / 1000 > M9_BUDGET){ m9Fail(); return; }
    // out-of-fuel nudge: contextual, once per dry-out (re-arms when you touch down)
    if (player.grounded) mission9.dry = false;
    else if (!mission9.dry && player.fuel < 0.6){
      mission9.dry = true;
      caption('THE POSTMASTER', 'TANK IS DRY - GET DOWN AND IT REFILLS ON THE GROUND.', 3600);
      mev(31);   // funnel: dry tank mid-air
    }
    var w = M9_WAY[mission9.cur];
    if (w && m9Reached(w)){
      mission9.cur++;
      mev(34);   // funnel: waypoint banked (per-leg)
      if (w.pad){
        sndTone(760, 0.22, 0, 'square', 0.14);
        puff(w.x, w.y + 1.2, w.z, M9_RING_COL, 0.25, 1.4, 420, 0.5, 0.7);
      } else {
        sndTone(880, 0.14, 0, 'triangle', 0.12);
      }
      // progress captions on the two mid-route pads (rings just chime + advance)
      if (mission9.cur === 2) caption('THE POSTMASTER', 'STOP 1 MADE - TANK TOPPED OFF.', 3200);
      else if (mission9.cur === 4) caption('THE POSTMASTER', 'HALFWAY UP - KEEP CLIMBING TO BIG BLUE.', 3400);
      if (mission9.cur >= M9_WAY.length){
        mission9.ms = now - mission9.t0;
        mission9.stage = 'won'; mission9.tStage = 0; mission9.capIdx = 0;
        for (var j = 0; j < m9Meshes.length; j++) m9Meshes[j].visible = false;
        sndWin(); sndApplause();
        caption('THE POSTMASTER', 'WHOLE ROUTE FLOWN, CAUGHT THE TRUCK. THE ROOFTOP MAIL PILOTS WOULD BE PROUD.', 5200);
        try {
          if (!m9Best || mission9.ms < m9Best){
            m9Best = mission9.ms;
            localStorage.setItem('lt_m9_best', String(Math.round(mission9.ms)));
          }
        } catch (e){}
        sendScore({t: 'score', ms: Math.round(mission9.ms), m: 9});   // NUMERIC 9 (not 'm9')
        mev(32);   // funnel: mission win
      }
    }
    return;
  }
  if (mission9.stage === 'won'){
    if (t > 5 && mission9.capIdx === 0){
      mission9.capIdx = 1;
      showScores(mission9.ms, 9);
      mission9.stage = 'post'; mission9.tStage = 0;
    }
    return;
  }
  if (mission9.stage === 'fail'){ if (t > 5) m9Cleanup(); return; }
  if (mission9.stage === 'post'){ if (t > 20) m9Cleanup(); }
}

// ---------- DAILY DASH (mission D): one rotating checkpoint route per day ----
// A daily challenge with its own global board: five checkpoints drawn
// deterministically from a twelve-landmark pool by the EST day seed, so every
// player worldwide runs the SAME course each day and it resets at the EST
// midnight boundary. dayIndex() is byte-identical to the server's copy — any
// drift would split-brain the reset. ANY locomotion is allowed once running
// (foot, car, jetpack, bus); only the finish time touches the server, as a
// numeric {t:'score', m:10}. Declared here — before the labels.push block and
// allIdle() below read MD_TRIG / missionD — because statement order matters.
function dayIndex(){ return Math.floor((Date.now() - 5 * 3600e3) / 86400e3); }
var MD_TRIG = {x: 44, z: -22};        // Cheapside courthouse plaza, off Main — clear of M9(14,-9.5) + M5(60,14)
var MD_N = 5;                          // checkpoints in a day's route
var MD_MAX = 900;                      // seconds; past this a run can't rank (== server ceiling) so we abandon it
// twelve real Lexington landmarks spread across the whole map (coords harvested
// from existing labels), so a day's five span downtown to the horse farms
var MD_POOL = [
  {x: 250,  z: 50,    name: 'THOROUGHBRED PARK'},
  {x: -370, z: 100,   name: 'RUPP ARENA'},
  {x: -85,  z: 96,    name: 'TRANSIT CENTER'},
  {x: 122,  z: 50,    name: 'PHOENIX PARK'},
  {x: -171, z: 40,    name: 'TRIANGLE PARK'},
  {x: 200,  z: 600,   name: 'UK CAMPUS'},
  {x: -190, z: 660,   name: 'KROGER FIELD'},
  {x: 500,  z: 428,   name: 'CHEVY CHASE'},
  {x: 350,  z: 300,   name: 'WOODLAND PARK'},
  {x: -520, z: -60,   name: 'DISTILLERY DISTRICT'},
  {x: 150,  z: -535,  name: 'DUNCAN PARK'},
  {x: -360, z: -1200, name: 'ELMENDORF FARM'}
];
// deterministic daily route: seeded Fisher-Yates over the pool with dayIndex()-
// derived wxRand draws, first MD_N in order. Same day => same five for everyone.
function mdRoute(day){
  var pool = MD_POOL.slice(), seed = day * 40503, i, j, tmp;
  for (i = pool.length - 1; i > 0; i--){
    j = Math.floor(wxRand(seed + i) * (i + 1));
    tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, MD_N);
}
// the day MD_CPS was built for. The local clock seeds it, but the server's
// dDay (riding along in every scores broadcast) overrides on mismatch — a
// spoofed/skewed clock or a tab left open across the EST flip would otherwise
// run yesterday's (or an arbitrary day's) route against today's board.
var mdDay = dayIndex();
var mdServerDay = null;   // latest dDay seen in a scores broadcast; wins over the local clock
var MD_CPS = mdRoute(mdDay);
// device best for TODAY only ({day, ms}); a stale (yesterday) best reads as null
var dailyBest = null;
try {
  var _db = JSON.parse(localStorage.getItem('lt_dailyBest') || 'null');
  if (_db && _db.day === dayIndex() && typeof _db.ms === 'number') dailyBest = _db;
} catch (e){}
var missionD = {stage: 'idle', tStage: 0, t0: 0, ms: 0, cur: 0, capIdx: 0, day: 0, localDay: 0};
var mdRings = [], mdTrig = null;
(function(){
  mdTrig = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 6, 24),
    new THREE.MeshBasicMaterial({color: 0xffd400, transparent: true, opacity: 0.85}));
  mdTrig.rotation.x = Math.PI / 2;
  mdTrig.position.set(MD_TRIG.x, 0.9, MD_TRIG.z);
  scene.add(mdTrig);
  for (var k = 0; k < MD_N; k++){
    var ring = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.12, 6, 28),
      new THREE.MeshBasicMaterial({color: 0xffd400, transparent: true, opacity: 0.7}));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(MD_CPS[k].x, 1.2, MD_CPS[k].z);
    ring.visible = false;
    scene.add(ring);
    mdRings.push(ring);
  }
})();
function nearMDTrig(){
  var dx = player.x - MD_TRIG.x, dz = player.z - MD_TRIG.z;
  return dx * dx + dz * dz < 16;
}
// (re)build the course for a day: route, ring positions, and a device best
// that no longer applies reads as null. Called at run start, on the mid-run
// day-flip abandon, and when a scores broadcast carries a different dDay.
function mdSetDay(day){
  mdDay = day;
  MD_CPS = mdRoute(day);
  for (var k = 0; k < MD_N; k++) mdRings[k].position.set(MD_CPS[k].x, 1.2, MD_CPS[k].z);
  if (dailyBest && dailyBest.day !== day) dailyBest = null;
}
function startMissionD(){
  // recompute in case the EST day rolled while the tab stayed open; the
  // server's day (when we've heard one) beats the local clock for the course
  mdSetDay(mdServerDay !== null ? mdServerDay : dayIndex());
  missionD.day = mdDay;
  missionD.localDay = dayIndex();   // local-midnight stamp — the mid-run flip check
  missionD.stage = 'run'; missionD.tStage = 0; missionD.capIdx = 0;
  missionD.cur = 0; missionD.ms = 0; missionD.t0 = performance.now();
  caption('THE DASH', 'TODAY\'S DAILY DASH - FIVE CHECKPOINTS, ANY WHEELS. FIRST: ' + MD_CPS[0].name + '.', 5200);
  addChatLine('* DAILY', 'THE DASH - five checkpoints, new route daily', true);
  mev(40);
}
function mdCleanup(){
  missionD.stage = 'idle';
  for (var k = 0; k < mdRings.length; k++) mdRings[k].visible = false;
}
function updateMissionD(dt){
  if (mdTrig){
    mdTrig.visible = allIdle();
    if (mdTrig.visible) mdTrig.rotation.z += dt * 0.8;
  }
  if (missionD.stage === 'idle') return;
  var now = performance.now();
  missionD.tStage += dt;
  var t = missionD.tStage;
  if (missionD.stage === 'run'){
    // only the current checkpoint ring is lit; it spins slowly
    for (var k = 0; k < mdRings.length; k++){
      var on = k === missionD.cur;
      mdRings[k].visible = on;
      if (on) mdRings[k].rotation.z += dt * 0.9;
    }
    // a run that can no longer rank (past the server ceiling) is abandoned, not
    // left as a zombie that would submit an out-of-window time
    if ((now - missionD.t0) / 1000 > MD_MAX){
      caption('THE DASH', 'TOO LONG ON THE CLOCK - RUN ABANDONED. TRY AGAIN AT THE COURTHOUSE.', 4200);
      mev(43);
      mdCleanup();
      return;
    }
    // the EST day flipped mid-run: rollDaily() has already emptied the server
    // board for the NEW route, so finishing now would rank an old-route time
    // (likely #1 on an empty board). Compared against the LOCAL day stamped at
    // start (not mdDay, which may be an adopted server day that differs from
    // this clock) so an adopted course doesn't insta-abandon. Abandon + rebuild.
    if (missionD.localDay !== dayIndex()){
      caption('THE DASH', 'MIDNIGHT - A NEW ROUTE JUST DROPPED. RUN ABANDONED. E TO RUN TODAY\'S.', 4600);
      mev(43);
      mdCleanup();
      mdSetDay(mdServerDay !== null ? mdServerDay : dayIndex());
      return;
    }
    // bank the current checkpoint on ANY locomotion (foot / car / jetpack / bus),
    // horizontal distance only so a low chopper pass or a drive-through both count
    var cp = MD_CPS[missionD.cur];
    if (Math.hypot(cp.x - player.x, cp.z - player.z) < 8){
      missionD.cur++;
      mev(41);
      if (missionD.cur >= MD_CPS.length){
        missionD.ms = now - missionD.t0;
        missionD.stage = 'won'; missionD.tStage = 0; missionD.capIdx = 0;
        for (var w = 0; w < mdRings.length; w++) mdRings[w].visible = false;
        sndWin(); sndApplause();
        caption('THE DASH', 'THAT IS THE DASH. TODAY\'S ROUTE, DONE.', 4600);
        try {
          if (!dailyBest || missionD.ms < dailyBest.ms){
            dailyBest = {day: dayIndex(), ms: Math.round(missionD.ms)};
            localStorage.setItem('lt_dailyBest', JSON.stringify(dailyBest));
          }
        } catch (e){}
        sendScore({t: 'score', ms: Math.round(missionD.ms), m: 10});   // numeric 10 — never a string
        mev(42);
      } else {
        sndTone(880, 0.18, 0, 'square', 0.14);
        // "N OF 5 BANKED" (count done), never "CHECKPOINT N/5" — the HUD timer
        // and hint both show the NEXT target's ordinal, and the two disagreeing
        // on screen at once reads as an off-by-one
        caption('THE DASH', missionD.cur + ' OF ' + MD_N + ' BANKED. NEXT: ' + MD_CPS[missionD.cur].name + '.', 3200);
      }
    }
    return;
  }
  if (missionD.stage === 'won'){
    if (t > 4.8 && missionD.capIdx === 0){
      missionD.capIdx = 1;
      showScores(missionD.ms, 10);
      missionD.stage = 'post'; missionD.tStage = 0;
    }
    return;
  }
  if (missionD.stage === 'post'){ if (t > 22) mdCleanup(); }
}
function allIdle(){
  return mission.stage === 'idle' && mission2.stage === 'idle' &&
         mission3.stage === 'idle' && mission4.stage === 'idle' &&
         mission5.stage === 'idle' && mission6.stage === 'idle' &&
         mission7.stage === 'idle' && mission8.stage === 'idle' &&
         mission9.stage === 'idle' && missionD.stage === 'idle';
}
// Everything mission-related on the overlay (start markers, target
// brackets, edge arrow, timers, zone chips, the fight chopper tag) draws
// in this one color, so mission UI is instantly tellable from player tags
// (#ffd28a) and ambient labels. Declared here — before the labels.push
// below runs — because top-level statement order matters in this file.
var MISSION_COL = '#ffd400';
// mission markers on the tactical overlay (gold, like the rings).
// `mission: true` hides them while any mission is running (the rings hide
// the same way via allIdle()) so only the live objective wears the color.
labels.push({name: '★ MISSION: THE RIBBON CUTTING', x: MISSION_TRIG.x, y: 9, z: MISSION_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: SNOW EMERGENCY', x: DOOR_P.x, y: 13, z: DOOR_P.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: THE DATA CENTER', x: M3_TRIG.x, y: 9, z: M3_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: HORSEPOWER', x: M4_TRIG.x, y: 9, z: M4_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: DEADLINE', x: M5_TRIG.x, y: 9, z: M5_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: THE MELT', x: M6_TRIG.x, y: 9, z: M6_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: TAILGATE COMPLIANCE', x: M7_TRIG.x, y: 9, z: M7_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: LOOSE IN THE PADDOCK', x: M8_TRIG.x, y: 9, z: M8_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ MISSION: AIR MAIL', x: M9_TRIG.x, y: 9, z: M9_TRIG.z, col: MISSION_COL, mission: true});
labels.push({name: '★ DAILY: THE DASH', x: MD_TRIG.x, y: 9, z: MD_TRIG.z, col: MISSION_COL, mission: true});
// the gentle shove: when nothing else is going on, point at the next mission
// bare next-unbeaten mission name, by the same best-gated chain ('' when all
// beaten). Shared by the hint AND the F2 welcome-back so the two can't disagree.
function nextMissionName(){
  if (!heliUnlocked) return 'THE RIBBON CUTTING';
  if (!m2Best) return 'SNOW EMERGENCY';
  if (!m3Best) return 'THE DATA CENTER';
  if (!m4Best) return 'HORSEPOWER';
  if (!m5Best) return 'DEADLINE';
  if (!m6Best) return 'THE MELT';
  if (!m7Best) return 'TAILGATE COMPLIANCE';
  if (!m8Best) return 'LOOSE IN THE PADDOCK';
  if (!m9Best) return 'AIR MAIL';
  // all nine beaten: point at today's DAILY DASH until it's run today
  if (!dailyBest || dailyBest.day !== dayIndex()) return 'THE DASH';
  return '';
}
// each mission's on-screen where-to-go suffix (DOM-only text, em dashes kept)
var MISSION_HINT_SUFFIX = {
  'THE RIBBON CUTTING': 'GOLD RING BY CITY HALL',
  'SNOW EMERGENCY': 'E AT THE CITY HALL DOOR',
  'THE DATA CENTER': 'TEAL RING, PHOENIX PARK',
  'HORSEPOWER': 'GREEN RING, THOROUGHBRED PARK',
  'DEADLINE': 'GOLD RING, THE BLOCK NEWSROOM (MAIN ST)',
  'THE MELT': 'PINK RING, W MAIN AT THE DISTILLERY DISTRICT',
  'TAILGATE COMPLIANCE': 'BLUE RING, KROGER FIELD LOTS',
  'LOOSE IN THE PADDOCK': 'AMBER RING AT ELMENDORF (NORTH, PAST NEW CIRCLE)',
  'AIR MAIL': 'VIOLET RING DOWNTOWN (JETPACK - HOLD SPACE)',
  'THE DASH': 'GOLD RING AT THE COURTHOUSE — NEW ROUTE DAILY'
};
function nextMissionHint(){
  var nm = nextMissionName();
  if (!nm) return '';
  // the ribbon cutting is the FIRST mission; everything after it is NEXT
  return (nm === 'THE RIBBON CUTTING' ? 'FIRST MISSION: ' : 'NEXT MISSION: ') +
    nm + ' — ' + MISSION_HINT_SUFFIX[nm];
}

// dev hook, only with #debug=1: poke the mission from the console
if (/debug=1/.test(hashStr)){
  window.__lt = {
    hit: function(){ missionHit(); },
    stage: function(){ return mission.stage; },
    unlock: function(){ return heliUnlocked; },
    m2stage: function(){ return mission2.stage; },
    m3stage: function(){ return mission3.stage; },
    m4stage: function(){ return mission4.stage; },
    m3: function(){ return mission3; },
    m4: function(){ return mission4; },
    m4h: function(){ return m4Horses; },
    m6: function(){ return mission6; },
    m7: function(){ return mission7; },
    veh: function(){ return !!player.veh; },
    m4horses: function(){ return m4Horses.map(function(h){ return {s: h.state, x: Math.round(h.g.position.x), z: Math.round(h.g.position.z)}; }); },
    photo: function(){ takePhoto(); },
    tp: function(x, z){ player.x = x; player.z = z; player.y = groundY(x, z); },
    tick: function(){ frameStep(performance.now()); },   // pump one frame while rAF is paused (hidden tab)
    tpcar: function(){   // hop next to the nearest vehicle (radio/drive testing)
      var best = null, bd = 1e12;
      for (var k = 0; k < vehicles.length; k++){
        var g = vehicles[k].g;
        var dx = g.position.x - player.x, dz = g.position.z - player.z;
        var d2 = dx * dx + dz * dz;
        if (d2 < bd){ bd = d2; best = vehicles[k]; }
      }
      if (best){
        player.x = best.g.position.x + 2; player.z = best.g.position.z;
        player.y = groundY(player.x, player.z);
      }
      return Math.round(Math.sqrt(bd));
    },
    audio: function(){ pokeAudio(); return AC ? AC.state : 'none'; },
    radio: function(){ return {st: radio.st, name: RADIO_STATIONS[radio.st].name, playing: !!radio.cur, last: radio.last}; },
    wx: function(state, intensity){
      if (state === undefined) return {state: wxCurState, intensity: wxCurIntensity, rain: +wxRain.toFixed(2), fog: +wxFog.toFixed(2)};
      wxOverride = state === null ? null : {state: state, intensity: intensity || 0.85};
    },
    aud: function(){
      var g = {};
      for (var k in ambLoops) g[k] = Math.round(ambLoops[k].h.g.gain.value * 100) / 100;
      return {simH: Math.round(simH * 10) / 10, night: envAt(simH).night, hFloor: aw.hFloor, loops: g};
    },
    clips: function(){ return Object.keys(clips).map(function(k){ return k + (clips[k].buf ? ':ok' : ':loading'); }); },
    pos: function(){ return {x: player.x, y: player.y, z: player.z}; },
    cam: function(){ return {az: rigP.az, el: rigP.el}; },
    bus: function(){ return player.bus; },
    busStateAt: function(t){ return busStateAt(t === undefined ? Date.now() : t); },
    busPeriod: function(){ return BUS_PERIOD; },
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
  if (player.ride || player.bus !== null || player.scoot) return;   // no firing from a passenger seat / scooter bars
  if (mission3.stage === 'photo' && !player.veh){ takePhoto(); return; }
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
  if (player.ride){ leaveRide(true); return; }   // hop out before any mission/enter gate
  if (player.bus !== null){ leaveBus(); return; }   // bus hop-out first too, mirroring the shotgun seat
  if (player.scoot){ dismountScoot(); return; }     // hop off the scooter before any mission/enter gate
  if (allIdle() && !player.veh && !isFrozen() && nearMissionTrig()){
    startMission();
    return;
  }
  if (heliUnlocked && allIdle() && !player.veh && !isFrozen() && nearDoor()){
    startMission2();
    return;
  }
  if (allIdle() && !player.veh && !isFrozen() && nearM3Trig()){
    startMission3();
    return;
  }
  if (allIdle() && !player.veh && !isFrozen() && nearM4Trig()){
    startMission4();
    return;
  }
  if (allIdle() && !player.veh && !isFrozen() && nearM5Trig()){
    startMission5();
    return;
  }
  if (allIdle() && !player.veh && !isFrozen() && nearM6Trig()){
    startMission6();
    return;
  }
  if (allIdle() && !player.veh && !isFrozen() && nearM7Trig()){
    startMission7();
    return;
  }
  if (allIdle() && !player.veh && !player.ride && player.bus === null && !player.scoot && !isFrozen() && nearM8Trig()){
    startMission8();
    return;
  }
  if (allIdle() && !player.veh && !player.ride && player.bus === null && !player.scoot && !isFrozen() && nearM9Trig()){
    startMission9();
    return;
  }
  if (allIdle() && !player.veh && !player.ride && player.bus === null && !player.scoot && !isFrozen() && nearMDTrig()){
    startMissionD();
    return;
  }
  if (!player.veh && !isFrozen()){
    var wh = calmableHorse();
    if (wh){ calmHorse(wh); return; }
  }
  if (canEnterHeli()){ requestHeli(); return; }
  if (player.veh){
    var v = player.veh;
    var px = v.g.position.x + Math.sin(v.th) * 3.4;
    var pz = v.g.position.z + Math.cos(v.th) * 3.4;
    player.veh = null;
    radioStop();
    playClip('sfx_door', {gain: 0.6});
    player.av.g.visible = true;
    player.x = px; player.z = pz;
    player.y = groundY(px, pz, player.y + 1); player.vy = 0;
    collide(player, 0.55, player.y);
    return;
  }
  if (canBoardBus()){ boardBus(); return; }         // catch the LexTown loop bus at a stop
  if (canMountScoot()){ mountScoot(); return; }     // grab a racked scooter (after bus, before the car-enter fallthrough)
  if (canRideShotgun()){ requestRide(); return; }   // board a friend's moving car
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
  playClip('sfx_door', {gain: 0.6});
  playClip('sfx_engine', {gain: 0.5});
  if (radio.st > 0) setTimeout(function(){ if (radioActive()) radioNext(true); }, 900);
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
  if ((player.ride || player.bus !== null) && mode === 'player') return;   // seat pose is written by updateRideAlong / updateBusRide
  if (player.heli && mode === 'player'){ updateHeliFlight(dt); return; }
  if (player.veh && mode === 'player'){ updateDrive(dt); return; }
  if (player.scoot && mode === 'player'){ updateScoot(dt); return; }   // grounded, avatar-visible ride — its own pose, NOT the seat-pose skip
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
    } else if (player.ride || player.bus !== null){
      ex = player.x; ey = player.y + 0.95; ez = player.z;   // seated eye height (player.y is already the seat)
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
    else if (player.ride || player.bus !== null)
      tAz = player.ry + Math.PI;   // settle behind the vehicle heading (player.ry carries it)
    else if (player.moving > 0)
      tAz = player.ry + Math.PI;
    if (tAz !== null)
      rigP.az += angDelta(rigP.az, tAz) * Math.min(1, dt * (player.veh || player.heli || player.ride || player.bus !== null ? 1.7 : 2.1));
  }
  rigP.r = Math.max(4, Math.min(90, rigP.r));
  camR += ((aiming ? (player.heli ? 9 : 4.4) : rigP.r) - camR) * Math.min(1, dt * 9);
  // over-the-shoulder framing: a light constant offset on foot (the avatar
  // rides left-of-center instead of blocking the view), stronger while aiming
  var onFoot = !player.veh && !player.heli && !player.ride && player.bus === null;
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
var ridePairs = {};   // passengerId -> driverId (seat bindings, from 'ride' broadcasts)
var ws = null, online = false;
function peerCount(){ return Object.keys(remotes).length; }
function setNetChip(){
  var base = 'NET: ' + (online ? 'ONLINE' : 'LOCAL-SIM') + ' · PEERS ' + peerCount();
  document.getElementById('netchip').textContent =
    roomCode ? 'ROOM ' + roomCode + ' · ' + base : base;
}
function removeRemote(id){
  var r = remotes[id];
  if (r){
    scene.remove(r.av.g);
    if (r.carG) scene.remove(r.carG);
    if (r.scootG) scene.remove(r.scootG);
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
// ---------- ride shotgun (passenger seat) ----------
// one tuning knob, shared by the local-passenger render AND the remote-passenger
// render so the seated figure sits in the same spot for everyone. lx runs along
// car-forward (cos th, -sin th); lz runs along car-lateral (sin th, cos th).
// lz is negative so the shotgun seat lands on the OPPOSITE side from the driver's
// +3.4 lateral exit-drop (tryEnterExit) - i.e. the passenger door, not the wheel.
var SEAT_OFFSET = { lx: -0.2, lz: -0.62, y: 1.05 };
function seatWorldPos(drvId){
  var cx, cy, cz, th;
  if (drvId === myId){
    if (!player.veh) return null;
    cx = player.veh.g.position.x; cy = player.veh.g.position.y; cz = player.veh.g.position.z; th = player.veh.th;
  } else {
    var r = remotes[drvId];
    if (!r || r.m !== 2 || !r.carG) return null;
    cx = r.carG.position.x; cy = r.carG.position.y; cz = r.carG.position.z; th = r.ry;
  }
  return { x: cx + SEAT_OFFSET.lx * Math.cos(th) + SEAT_OFFSET.lz * Math.sin(th),
           y: cy + SEAT_OFFSET.y,
           z: cz - SEAT_OFFSET.lx * Math.sin(th) + SEAT_OFFSET.lz * Math.cos(th),
           ry: th };
}
function seatTaken(drvId){
  for (var p in ridePairs) if (ridePairs[p] === drvId) return true;
  return false;
}
function nearestDriver(){
  var best = null, bd = 64;   // 8m squared - wider than the 6.5m on-foot enter check
  for (var id in remotes){
    var r = remotes[id];
    if (r.m !== 2 || !r.carG || seatTaken(id)) continue;
    var dx = r.carG.position.x - player.x, dz = r.carG.position.z - player.z;
    var d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = id; }
  }
  return best;
}
function canRideShotgun(){
  return mode === 'player' && !player.veh && !player.heli && !player.ride && player.bus === null &&
    !player.scoot && !isFrozen() && player.grounded && nearestDriver() !== null;
}
function requestRide(){
  var drv = nearestDriver();
  if (!drv) return;
  if (online && ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'ride', a: 'enter', drv: drv}));
}
function enterRideLocal(drvId){
  player.ride = drvId;
  setPvp(false);   // holster the blaster - a passenger is not a tag target
  rigP.r = Math.max(rigP.r, 17);
  playClip('sfx_door', {gain: 0.6});
  caption('RIDING SHOTGUN', remotes[drvId] ? remotes[drvId].name : 'DRIVER', 2200);
  if (radio.st > 0) setTimeout(function(){ if (radioActive()) radioNext(true); }, 900);
}
function leaveRide(sendMsg){
  if (!player.ride) return;
  player.ride = null;
  radioStop();
  player.y = groundY(player.x, player.z, player.y + 1);
  player.vy = 0; player.grounded = false;
  collide(player, 0.55, player.y);
  player.av.g.visible = (mode !== 'player' || !camFP);
  if (sendMsg && online && ws && ws.readyState === 1) ws.send(JSON.stringify({t: 'ride', a: 'exit'}));
}
function handleRideMsg(m){
  if (m.a === 'enter'){
    ridePairs[m.pax] = m.drv;
    if (m.pax === myId) enterRideLocal(m.drv);
    else if (m.drv === myId) caption(remotes[m.pax] ? remotes[m.pax].name : 'SOMEONE', 'hopped in — shotgun', 2200);
  } else if (m.a === 'deny'){
    caption('RIDE', 'that seat is taken', 1800);
  } else if (m.a === 'exit' || m.a === 'eject'){
    delete ridePairs[m.pax];
    if (m.pax === myId && player.ride){
      leaveRide(false);
      if (m.a === 'eject') caption(remotes[m.drv] ? remotes[m.drv].name : 'DRIVER', 'parked — you hopped out', 2600);
    }
  }
}
function updateRideAlong(dt){
  if (!player.ride || mode !== 'player') return;
  var seat = seatWorldPos(player.ride);
  if (!seat) return;   // driver's car not interpolated yet - hold last pose
  player.x = seat.x; player.y = seat.y; player.z = seat.z; player.ry = seat.ry;
  player.moving = 0; player.thrusting = false; player.grounded = true;
  setSwing(player.av, 0, 0);
  player.av.g.position.set(seat.x, seat.y, seat.z);
  player.av.g.rotation.y = seat.ry;
}
function handleNet(m){
  if (m.t === 'welcome'){
    myId = m.id; online = true;
    Object.keys(remotes).forEach(function(id){ if (id.indexOf('BOT') === 0) removeRemote(id); });
    (m.peers || []).forEach(handleNet);
    if (m.heli) handleHeliMsg(m.heli);
    if (m.seats){ for (var si = 0; si < m.seats.length; si++) ridePairs[m.seats[si].pax] = m.seats[si].drv; }
    setNetChip();
    var adm = /admin=([^&#]+)/.exec(hashStr);   // #admin=<token> auto-auth
    if (adm) ws.send(JSON.stringify({t: 'chat', msg: '/admin ' + decodeURIComponent(adm[1])}));
  } else if (m.t === 'state'){
    if (m.id === myId) return;
    var r = remotes[m.id];
    if (!r){
      r = remotes[m.id] = {av: makeAvatar(m.c || 0x3a76c4, 0x555a63), name: m.n || m.id,
        c: m.c || 0x3a76c4, m: 0, carG: null, scootG: null,
        buf: [], phase: Math.random() * 6, swing: 0, lx: m.x, lz: m.z, ry: m.ry || 0};
      setNetChip();
    }
    r.m = m.m | 0;
    r.p = m.p | 0;
    if (m.n && m.n !== r.name) r.name = m.n;   // live rename
    if (typeof m.c === 'number' && m.c !== r.c){ r.c = m.c; if (r.av.torso) r.av.torso.color.setHex(m.c); }   // live recolor (F2)
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
  } else if (m.t === 'ride'){
    handleRideMsg(m);
  } else if (m.t === 'pushed'){
    // the cannon only shoves players whose movement branch actually consumes
    // kx/kz (on foot / jetpack). Vehicle/seat/scooter branches skip that block,
    // so accumulating here would bank invisible impulse that bursts as a
    // teleport the frame after dismount.
    if (m.id === myId && !player.veh && !player.heli && !player.ride &&
        player.bus === null && !player.scoot){
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
    // the server's day wins: a scores broadcast carrying a dDay we don't match
    // means a skewed/spoofed local clock or the EST day flipping under an open
    // tab — rebuild the course on the server's day (abandoning any live run,
    // whose banked checkpoints belong to a route the board no longer holds)
    if (typeof m.dDay === 'number'){
      mdServerDay = m.dDay;
      if (m.dDay !== mdDay){
        if (missionD.stage === 'run'){
          caption('THE DASH', 'THE BOARD ROLLED TO A NEW ROUTE. RUN ABANDONED. E TO RUN TODAY\'S.', 4600);
          mev(43);
          mdCleanup();
        }
        mdSetDay(m.dDay);
      }
    }
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
  if (/^\/room\b/i.test(msg)){   // /room <code> switches worlds; never sent to the server
    var rc = cleanRoom(msg.replace(/^\/room\b\s*/i, ''));
    location.hash = rc ? 'room=' + rc : '';
    location.reload();
    return;
  }
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
      if (r.scootG) r.scootG.visible = false;
      r.carG.position.set(x, y + 0.15, z);
      r.carG.rotation.y = r.ry;
    } else if (r.m === 3){ // flying the news chopper: the one heli follows them
      if (r.carG) r.carG.visible = false;
      if (r.scootG) r.scootG.visible = false;
      r.av.g.visible = false;
      r.av.g.position.set(x, y, z);   // tag/dart anchor
      heli.pilot = id;
      heli.x = x; heli.y = y + 1.2; heli.z = z; heli.th = r.ry;
      if (!heli.down){
        heli.mesh.position.set(heli.x, heli.y, heli.z);
        heli.mesh.rotation.y = heli.th;
        heli.mesh.rotation.z += (-Math.min(36, spd) * 0.007 - heli.mesh.rotation.z) * Math.min(1, dt * 4);
      }
    } else if (r.m === 4){ // riding shotgun: seat the avatar on the bound driver's car
      if (r.carG) r.carG.visible = false;
      if (r.scootG) r.scootG.visible = false;
      r.av.g.visible = true;
      setSwing(r.av, 0, 0);   // at-rest pose - a passenger isn't walking
      r.av.flames.forEach(function(fl){ fl.visible = false; });
      r.av.gun.visible = false;
      r.av.ice.visible = false;
      var drv = ridePairs[id], seat = drv ? seatWorldPos(drv) : null;
      if (seat){ r.av.g.position.set(seat.x, seat.y, seat.z); r.av.g.rotation.y = seat.ry; }
      else if (!drv){
        // no shotgun binding AT ALL: if they're netted onto the loop bus, snap them
        // into a deterministic seat so they don't trail 1.4m out the back of a moving
        // bus. A known binding whose driver car hasn't resolved yet must NOT fall in
        // here — a shotgun passenger driven along the bus's own streets would get
        // snapped into the bus during the join race.
        var bs = busStateAt(Date.now()), dbx = x - bs.x, dbz = z - bs.z;
        if (dbx * dbx + dbz * dbz < 20.25){   // within 4.5m of the local bus → a passenger
          var bseat = busSeatWorld(bs, busSeatFor(id));
          r.av.g.position.set(bseat.x, bseat.y, bseat.z); r.av.g.rotation.y = bseat.ry;
        } else { r.av.g.position.set(x, y, z); r.av.g.rotation.y = r.ry; }   // fall back to their own packets
      }
      else { r.av.g.position.set(x, y, z); r.av.g.rotation.y = r.ry; }   // binding known, car not built yet — their packets already mirror the seat
    } else if (r.m === 5){ // riding a scooter: standing avatar + a scooter mesh under them
      if (r.carG) r.carG.visible = false;
      if (!r.scootG) r.scootG = buildRemoteScooter();
      r.scootG.visible = true;
      r.av.g.visible = true;
      setSwing(r.av, 0, 0);   // standing, no walk swing
      r.av.armL.rotation.x = -1.1; r.av.armR.rotation.x = -1.1;   // hands forward on the bars
      r.av.flames.forEach(function(fl){ fl.visible = false; });
      r.av.gun.visible = false;
      r.av.ice.visible = !!(r.frozenUntil && now < r.frozenUntil);
      r.av.g.position.set(x, y, z);
      r.av.g.rotation.y = r.ry;
      r.scootG.position.set(x, y, z);
      r.scootG.rotation.y = r.ry;
    } else {
      if (r.carG) r.carG.visible = false;
      if (r.scootG) r.scootG.visible = false;
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
  // route to a private room (F4); baked once so reconnects keep the room
  if (url && roomCode) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'room=' + encodeURIComponent(roomCode);
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
      m: (player.ride || player.bus !== null) ? 4 : player.heli ? 3 : player.veh ? 2 : player.scoot ? 5 : (player.thrusting ? 1 : 0),
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
// courthouse square -> City Hall -> NoLi -> horse farms -> UK campus ->
// Chevy Chase -> wide pull-back
var PRESETS = [
  {t: [-330, 0, 105], r: 280, el: 0.46},
  {t: [-130, 0, 50],  r: 165, el: 0.44},
  {t: [-20, 0, -5],   r: 190, el: 0.46},
  {t: [50, 0, -45],   r: 140, el: 0.48},
  {t: [168, 0, 35],   r: 155, el: 0.46},
  {t: [60, 0, -620],  r: 240, el: 0.46},
  {t: [-50, 0, -1150], r: 380, el: 0.45},
  {t: [200, 0, 580],  r: 320, el: 0.5},
  {t: [500, 0, 430],  r: 170, el: 0.46},
  {t: [40, 0, 160],   r: 520, el: 0.62}
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

// ---------- cinematic mode (trailer capture) ----------
// #cine=1 strips every bit of chrome (DOM HUD + the tactical overlay + the
// CRT/vignette layer + captions) so the frame is nothing but the 3D world.
// The scripted-camera primitives below are wired onto window.__lt (only under
// #debug=1) so a CDP-driven capture can compose deterministic shots. Nothing
// here touches the net or the sim — traffic, missions and day/night keep
// running underneath so the shots have life. A pose is {x,y,z,ry,pitch} where
// ry is compass yaw (0 looks toward +z, +PI/2 toward +x) and pitch tilts up
// (+) / down (-); cineCurrentPose and cineApplyPose are exact inverses (they
// round-trip through camera.getWorldDirection) so there's no conversion drift.
var CINE = /cine=1/.test(hashStr);
var cine = {active: false, busy: false, bars: true, mode: null, t: 0,
            from: null, to: null, dur: 0, ease: 'inout', orbitP: null, followP: null};
if (CINE){
  var _hudEl = document.getElementById('hud');
  if (_hudEl) _hudEl.style.display = 'none';
  var _fxEl = document.getElementById('fx');
  if (_fxEl) _fxEl.style.display = 'none';
}
// Photo Mode (F2): a transient LOCAL camera+capture state, composed from parts
// that already exist — the drone rig (posing), the sim pause (a clean frame),
// cineLetterbox (bars), and the CINE chrome-hide (HUD off). The only net-new
// piece is the capture: a grab-next-frame flag read right AFTER renderer.render
// so we never pay the global preserveDrawingBuffer GPU cost. Declared up here so
// the keydown handler, drawOverlay, and the frame-end capture can all read it.
var photo = {active: false, bars: true, tags: false, pausedByUs: false, priorMode: null, flashUntil: 0};
var captureNext = false;
function cineEase(f, kind){
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  if (kind === 'linear') return f;
  if (kind === 'in') return f * f;
  if (kind === 'out') return f * (2 - f);
  return f * f * (3 - 2 * f);   // smoothstep (inout), the default
}
function cinePoseFrom(p){
  return {x: p.x || 0, y: p.y || 0, z: p.z || 0, ry: p.ry || 0, pitch: p.pitch || 0};
}
function cineCurrentPose(){
  var d = new THREE.Vector3();
  camera.getWorldDirection(d);
  return {x: camera.position.x, y: camera.position.y, z: camera.position.z,
          ry: Math.atan2(d.x, d.z),
          pitch: Math.asin(Math.max(-1, Math.min(1, d.y)))};
}
function cineApplyPose(p){
  var cp = Math.cos(p.pitch);
  camera.position.set(p.x, p.y, p.z);
  camera.lookAt(p.x + cp * Math.sin(p.ry), p.y + Math.sin(p.pitch), p.z + cp * Math.cos(p.ry));
}
function cineShot(o){
  o = o || {};
  cine.mode = 'shot';
  cine.from = o.from ? cinePoseFrom(o.from) : cineCurrentPose();
  cine.to = o.to ? cinePoseFrom(o.to) : cine.from;
  cine.dur = o.dur > 0 ? o.dur : 3;
  cine.ease = o.ease || 'inout';
  cine.t = 0; cine.active = true; cine.busy = true;
  return cine;
}
function cineOrbit(o){
  o = o || {};
  cine.mode = 'orbit';
  cine.orbitP = {x: o.x || 0, z: o.z || 0, r: o.r > 0 ? o.r : 120,
                 y: o.y === undefined ? 70 : o.y,
                 degStart: o.degStart || 0,
                 degEnd: o.degEnd === undefined ? 90 : o.degEnd,
                 dur: o.dur > 0 ? o.dur : 8,
                 lookY: o.lookY === undefined ? 12 : o.lookY};
  cine.t = 0; cine.active = true; cine.busy = true;
  return cine;
}
function cineFollowPick(what){
  if (what === 'heli') return heli;
  if (what === 'player') return player;
  var best = null, bd = 1e18;   // nearest AI traffic car to the current camera
  for (var i = 0; i < cars.length; i++){
    var g = cars[i].g;
    var dx = g.position.x - camera.position.x, dz = g.position.z - camera.position.z;
    var d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = cars[i]; }
  }
  return best;
}
function cineFollowPos(ent, what){
  if (!ent) return null;
  if (what === 'heli') return {x: heli.x, y: heli.y, z: heli.z};
  if (what === 'player') return {x: player.x, y: player.y, z: player.z};
  return {x: ent.g.position.x, y: ent.g.position.y, z: ent.g.position.z};
}
function cineFollow(o){
  o = o || {};
  var what = o.what || 'car';
  var ent = cineFollowPick(what);
  var pos = cineFollowPos(ent, what);
  cine.mode = 'follow';
  cine.followP = {what: what, target: ent,
                  dist: o.dist > 0 ? o.dist : 12,
                  height: o.height === undefined ? 4 : o.height,
                  dur: o.dur > 0 ? o.dur : 8,
                  lx: pos ? pos.x : 0, lz: pos ? pos.z : 0,
                  hx: 0, hz: 1, snapped: false};
  cine.t = 0; cine.active = true; cine.busy = true;
  return cine;
}
function cineStop(){ cine.active = false; cine.busy = false; cine.mode = null; return true; }
function cineSetBars(on){ cine.bars = !!on; return cine.bars; }
function cineLetterbox(){
  var bh = Math.round(vh * 0.12);
  ov.fillStyle = '#000';
  ov.fillRect(0, 0, vw, bh);
  ov.fillRect(0, vh - bh, vw, bh);
}
function updateCineCam(dt){
  if (cine.mode === 'shot'){
    cine.t += dt;
    var f = cine.dur > 0 ? Math.min(1, cine.t / cine.dur) : 1;
    var e = cineEase(f, cine.ease);
    var a = cine.from, b = cine.to;
    cineApplyPose({
      x: a.x + (b.x - a.x) * e,
      y: a.y + (b.y - a.y) * e,
      z: a.z + (b.z - a.z) * e,
      ry: a.ry + angDelta(a.ry, b.ry) * e,
      pitch: a.pitch + (b.pitch - a.pitch) * e
    });
    if (f >= 1) cine.busy = false;
  } else if (cine.mode === 'orbit'){
    var op = cine.orbitP;
    cine.t += dt;
    var f2 = op.dur > 0 ? Math.min(1, cine.t / op.dur) : 1;
    var deg = op.degStart + (op.degEnd - op.degStart) * cineEase(f2, 'inout');
    var rad = deg * Math.PI / 180;
    camera.position.set(op.x + op.r * Math.sin(rad), op.y, op.z + op.r * Math.cos(rad));
    camera.lookAt(op.x, op.lookY, op.z);
    if (f2 >= 1) cine.busy = false;
  } else if (cine.mode === 'follow'){
    var fo = cine.followP;
    cine.t += dt;
    var pos = cineFollowPos(fo.target, fo.what);
    if (pos){
      var vx = pos.x - fo.lx, vz = pos.z - fo.lz;
      var vl = Math.hypot(vx, vz);
      if (vl > 0.03){ fo.hx = vx / vl; fo.hz = vz / vl; }
      fo.lx = pos.x; fo.lz = pos.z;
      var dX = pos.x - fo.hx * fo.dist;
      var dZ = pos.z - fo.hz * fo.dist;
      var dY = pos.y + fo.height;
      if (!fo.snapped && vl > 0.03){
        camera.position.set(dX, dY, dZ); fo.snapped = true;
      } else {
        var kk = Math.min(1, dt * 2.4);
        camera.position.set(
          camera.position.x + (dX - camera.position.x) * kk,
          camera.position.y + (dY - camera.position.y) * kk,
          camera.position.z + (dZ - camera.position.z) * kk);
      }
      camera.lookAt(pos.x, pos.y + 1.1, pos.z);
    }
    if (fo.dur > 0 && cine.t >= fo.dur) cine.busy = false;
  }
}
if (window.__lt){   // extend the debug hook (only present under #debug=1)
  window.__lt.cine = cine;   // busy is a live boolean on this same object
  cine.shot = cineShot;
  cine.orbit = cineOrbit;
  cine.follow = cineFollow;
  cine.stop = cineStop;
  cine.setBars = cineSetBars;
  cine.pose = cineCurrentPose;   // read the live camera pose to seed a shot
}

// pointer controls
var drag = null;
var stick = {active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, jets: false};
var ptrLocked = false, ads = false, followPause = 0;
// pointer lock: free mouse-look in player mode; LMB fires, RMB aims
glCanvas.addEventListener('click', function(){
  if (mode === 'player' && !IS_COARSE && !ptrLocked && els.tut.hidden){
    try { var pl = glCanvas.requestPointerLock(); if (pl && pl.catch) pl.catch(function(){}); } catch (e){}
  }
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
  if (photo.active){   // Enter = desktop shutter, Esc = leave Photo Mode (chat is hidden here)
    if (e.key === 'Enter'){ e.preventDefault(); photoShutter(); return; }
    if (e.key === 'Escape'){ e.preventDefault(); exitPhoto(); return; }
    if (e.key.toLowerCase() === 'v') return;   // mode toggle would break the drone-only premise
  }
  if (els.scores && !els.scores.hidden &&
      (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'e')){
    els.scores.hidden = true;
    e.preventDefault();
    return;
  }
  if ((e.key === 'Escape' || e.key === 'Enter') && !els.tut.hidden){ tutClose(); return; }
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
  if (k === 'l') setToggle('lbl');
  if (k === 'r') cycleRadio();
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
var show = {box: true, lbl: true, waypt: true};
try { if (localStorage.getItem('lt_waypt') === '0') show.waypt = false; } catch (e){}
if (/wp=0/.test(location.hash)) show.waypt = false;
var objBannerDone = false;
try { objBannerDone = localStorage.getItem('lt_obj_banner_seen') === '1'; } catch (e){}
var rideTipShown = false;
try { rideTipShown = !!localStorage.getItem('lt_ride_seen'); } catch (e){}
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
  bLbl: document.getElementById('bLbl'), bWaypt: document.getElementById('bWaypt'),
  bPause: document.getElementById('bPause'),
  bFP: document.getElementById('bFP'), bMenu: document.getElementById('bMenu'),
  tray: document.getElementById('tray'),
  bSnd: document.getElementById('bSnd'), bRadio: document.getElementById('bRadio'),
  bScores: document.getElementById('bScores'),
  scores: document.getElementById('scores'),
  bWx: document.getElementById('bWx'), wx: document.getElementById('wx'),
  bGhost: document.getElementById('bGhost'),
  s1: document.getElementById('s1'), s60: document.getElementById('s60'), s300: document.getElementById('s300')
};
els.ncars.textContent = cars.length; els.npeds.textContent = peds.length;
function syncBtns(){
  els.bView.classList.toggle('on', mode === 'drone');
  els.bNerf.classList.toggle('on', player.pvp);
  els.bFP.classList.toggle('on', camFP);
  els.bAuto.classList.toggle('on', autoCam);
  els.bBox.classList.toggle('on', show.box);
  els.bLbl.classList.toggle('on', show.lbl);
  els.bWaypt.classList.toggle('on', show.waypt);
  els.bPause.classList.toggle('on', paused);
  els.bPause.textContent = paused ? '>' : '||';
  els.s1.classList.toggle('on', speed === 1 && !paused);
  els.s60.classList.toggle('on', speed === 60 && !paused);
  els.s300.classList.toggle('on', speed === 300 && !paused);
  els.bMenu.classList.toggle('on', !els.tray.hidden);
  els.bSnd.classList.toggle('on', sndOn);
  els.bSnd.textContent = sndOn ? 'SND ON' : 'SND OFF';
  els.bRadio.classList.toggle('on', radio.st > 0);
  if (els.bWx) els.bWx.classList.toggle('on', wxEnabled);
  if (els.bGhost) els.bGhost.classList.toggle('on', ghostEnabled);
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
els.bRadio.onclick = cycleRadio;
if (els.bWx) els.bWx.onclick = function(){   // WX tray toggle: off forces clear, persisted
  wxEnabled = !wxEnabled;
  try { localStorage.setItem('lt_wx', wxEnabled ? '1' : '0'); } catch (e){}
  syncBtns();
};
if (els.bGhost) els.bGhost.onclick = function(){   // GHOST tray toggle: off hides the replay; recording still banks a best
  ghostEnabled = !ghostEnabled;
  try { localStorage.setItem('lt_ghost', ghostEnabled ? '1' : '0'); } catch (e){}
  if (ghostEnabled && mission5.stage === 'driving' && !ghost) loadGhost();   // turned on mid-run: bring the ghost in
  if (!ghostEnabled) hideGhost();
  syncBtns();
};
document.getElementById('radiochip').onclick = cycleRadio;
els.bScores.onclick = function(){ showScores(0); };

// ---------- Photo Mode wiring (F2) ----------
var bPhotoEl = document.getElementById('bPhoto');
var photobarEl = document.getElementById('photobar');
var photoStatusEl = document.getElementById('photostatus');
function photoSay(msg){ if (photoStatusEl) photoStatusEl.textContent = msg; }
function syncPhotoBtns(){
  var pp = document.getElementById('bPPause'); if (pp) pp.classList.toggle('on', paused);
  var pb = document.getElementById('bPBars'); if (pb) pb.classList.toggle('on', photo.bars);
  var pt = document.getElementById('bPTags'); if (pt) pt.classList.toggle('on', photo.tags);
}
function enterPhoto(){
  if (photo.active) return;
  photo.priorMode = mode;
  if (mode !== 'drone') toggleMode();              // free-flying rig for posing
  photo.pausedByUs = false;
  if (!paused){ togglePause(); photo.pausedByUs = true; }   // freeze traffic/peds for a clean frame
  photo.active = true; photo.flashUntil = 0;
  var hudEl = document.getElementById('hud'); if (hudEl) hudEl.style.display = 'none';
  var fxEl = document.getElementById('fx'); if (fxEl) fxEl.style.display = 'none';
  if (photobarEl) photobarEl.hidden = false;
  photoSay('PHOTO MODE - pose & shoot');
  syncPhotoBtns();
}
function exitPhoto(){
  if (!photo.active) return;
  photo.active = false;
  captureNext = false;   // a shutter pressed the same frame as exit must not fire on the restored view
  if (photobarEl) photobarEl.hidden = true;
  var hudEl = document.getElementById('hud'); if (hudEl) hudEl.style.display = '';
  var fxEl = document.getElementById('fx'); if (fxEl) fxEl.style.display = '';
  if (photo.pausedByUs && paused) togglePause();   // un-pause ONLY what Photo Mode itself paused
  photo.pausedByUs = false;
  if (photo.priorMode === 'player' && mode !== 'player') toggleMode();   // restore the camera we came from
  photo.priorMode = null;
}
function photoShutter(){ captureNext = true; }     // honored right after renderer.render (grab-next-frame)
// name tags on the composite (TAGS on): a compact reuse of the drawOverlay tag
// draw — project each remote's head and label it. Offline bots ride `remotes` too.
function drawPhotoTags(){
  camera.getWorldPosition(camPos);
  ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
  for (var id in remotes){
    var r = remotes[id];
    var pos = r.m === 2 && r.carG ? r.carG.position : r.av.g.position;
    var p = project(pos.x, pos.y + 2.9, pos.z);
    if (!p) continue;
    var nm = r.name || '';
    var tw = ov.measureText(nm).width;
    chip(p[0] - tw / 2, p[1], nm, '#ffd28a');
  }
}
function photoTs(){
  var d = new Date();
  function p2(n){ return ('0' + n).slice(-2); }
  return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' +
         p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}
function photoStamp(cx, W, H){   // low-opacity LEXTOWN wordmark, bottom-right — the watermark that points home
  var fs = Math.max(12, Math.round(H * 0.026)), pad = Math.round(fs * 0.8);
  cx.save();
  cx.font = '700 ' + fs + 'px ui-monospace, Menlo, Consolas, monospace';
  cx.textAlign = 'right'; cx.textBaseline = 'alphabetic';
  cx.globalAlpha = 0.5; cx.fillStyle = '#04120f';
  cx.fillText('LEXTOWN', W - pad + 1, H - pad + 1);   // shadow for contrast on light frames
  cx.globalAlpha = 0.82; cx.fillStyle = '#e9fff9';
  cx.fillText('LEXTOWN', W - pad, H - pad);
  cx.restore();
}
function photoDownload(blob){
  var url = URL.createObjectURL(blob);
  var name = 'lextown-' + photoTs() + '.jpg';
  var a = document.createElement('a');
  // mobile Safari can't fire a programmatic download -> open the blob so the user long-press-saves
  var noDl = (typeof a.download === 'undefined');
  var iOS = /iP(hone|ad|od)/.test(navigator.platform || '') || /(iPhone|iPad|iPod)/.test(navigator.userAgent || '') ||
            (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  if (noDl || iOS){
    window.open(url, '_blank');
    photoSay('long-press the image to save');
  } else {
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    photoSay('saved ' + name);
  }
  setTimeout(function(){ URL.revokeObjectURL(url); }, 20000);
}
function photoCapture(){   // runs right after renderer.render + drawOverlay — the WebGL buffer is still valid
  try {
    var W = glCanvas.width, H = glCanvas.height;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var cx = c.getContext('2d');
    cx.drawImage(glCanvas, 0, 0, W, H);          // the 3D frame
    cx.drawImage(ovCanvas, 0, 0, W, H);          // bars + optional tags (drawn this frame by drawOverlay)
    photoStamp(cx, W, H);
    photo.flashUntil = performance.now() + 140;  // shutter cue — set AFTER the grab so it's never in the shot
    if (!c.toBlob){ photoSay("couldn't save that shot"); return; }
    c.toBlob(function(blob){
      if (!blob){ photoSay("couldn't save that shot"); return; }
      photoDownload(blob);
    }, 'image/jpeg', 0.92);
  } catch (e){ photoSay("couldn't save that shot"); }
}
if (bPhotoEl) bPhotoEl.onclick = enterPhoto;
(function(){
  var b;
  b = document.getElementById('bShutter'); if (b) b.onclick = photoShutter;
  b = document.getElementById('bPExit'); if (b) b.onclick = exitPhoto;
  b = document.getElementById('bPPause'); if (b) b.onclick = function(){ togglePause(); syncPhotoBtns(); };
  b = document.getElementById('bPBars'); if (b) b.onclick = function(){ photo.bars = !photo.bars; syncPhotoBtns(); };
  b = document.getElementById('bPTags'); if (b) b.onclick = function(){ photo.tags = !photo.tags; syncPhotoBtns(); };
})();
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
els.bLbl.onclick = function(){ setToggle('lbl'); };
els.bWaypt.onclick = function(){
  show.waypt = !show.waypt;
  try { localStorage.setItem('lt_waypt', show.waypt ? '1' : '0'); } catch (e){}
  syncBtns();
};
els.bPause.onclick = togglePause;
els.s1.onclick = function(){ setSpeed(1); };
els.s60.onclick = function(){ setSpeed(60); };
els.s300.onclick = function(){ setSpeed(300); };
syncBtns();

// ---------- tutorial / about ----------
var nameIn = document.getElementById('nameIn');
nameIn.value = myName;
// CALL SIGN color picker: one swatch per PLAYER_COLS entry. The container
// (#swatches, .swatch/.swatch.on) is built in index.html; if it isn't there
// yet this no-ops. The pick is staged in _pendColor and committed by applyName.
var _pendColor = myColorIdx;
(function(){
  var box = document.getElementById('swatches');
  if (!box) return;   // container not present - graceful no-op
  var i;
  for (i = 0; i < PLAYER_COLS.length; i++){
    (function(idx){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (idx === myColorIdx ? ' on' : '');
      b.style.background = '#' + ('000000' + PLAYER_COLS[idx].toString(16)).slice(-6);
      b.setAttribute('aria-label', 'call sign color ' + (idx + 1));
      b.onclick = function(){
        _pendColor = idx;
        var kids = box.children, k;
        for (k = 0; k < kids.length; k++) kids[k].className = 'swatch' + (k === idx ? ' on' : '');
      };
      box.appendChild(b);
    })(i);
  }
})();
// room field (F4): seed the current room + wire the share-link copy. Both live
// in the tutorial CALL SIGN block (index.html); guard absence (dev-2 parallel).
(function(){
  var roomIn = document.getElementById('roomIn');
  if (roomIn) roomIn.value = roomCode;
  var copyBtn = document.getElementById('copyRoom');
  if (!copyBtn) return;
  copyBtn.onclick = function(){
    var code = roomIn ? cleanRoom(roomIn.value) : roomCode;
    // deliberately excludes #name= so a shared link doesn't rename the invitee
    var link = location.origin + location.pathname + location.search + (code ? '#room=' + code : '');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link);
    var was = copyBtn.textContent;
    copyBtn.textContent = 'LINK COPIED';
    setTimeout(function(){ copyBtn.textContent = was; }, 1500);
  };
})();
function applyName(){
  // color first, so a color-only change still applies past the name early-return
  if (_pendColor !== myColorIdx){
    myColorIdx = _pendColor;
    myColor = PLAYER_COLS[myColorIdx];
    try { localStorage.setItem('lt_color', String(myColorIdx)); } catch (e){}
    if (player.av.torso) player.av.torso.color.setHex(myColor);
    syncBtns();
  }
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
var _welcomed = false;
var welcomeBackAt = 0;   // >0 arms the returning-player greeting window
// returning-player greeting; names the next unbeaten mission (or all-beaten)
function welcomeBackLine(){
  var nm = nextMissionName();
  return nm ? 'WELCOME BACK, ' + myName + '. ' + nm + ' IS STILL OPEN - FOLLOW THE GOLD MARKER.'
            : 'WELCOME BACK, ' + myName + '. YOU BEAT EVERY MISSION - CHASE A FASTER TIME.';
}
function tutClose(){
  applyName();
  // room switch (F4): applyName already persisted name/color, so a reload keeps
  // them. Changing rooms means a fresh ws connection, so just reload the page.
  var _roomIn = document.getElementById('roomIn');
  if (_roomIn){
    var nr = cleanRoom(_roomIn.value);
    if (nr !== roomCode){
      // mark the tutorial seen BEFORE the reload or a first-run player who
      // typed a room code gets the modal a second time on the other side
      try { localStorage.setItem('lt_tut_seen', '1'); } catch (e){}
      location.hash = nr ? 'room=' + nr : '';
      location.reload();
      return;   // page is navigating away - nothing else should run
    }
  }
  els.tut.hidden = true;
  try { localStorage.setItem('lt_tut_seen', '1'); } catch (e){}
  // first-session shove toward the missions
  if (!_welcomed && !heliUnlocked && allIdle()){
    _welcomed = true;
    setTimeout(function(){
      if (allIdle()){
        caption('DISPATCH', 'WELCOME TO LEXTOWN. SEE THE GOLD RING BY CITY HALL? GO PRESS E ON IT. TRUST ME.', 6500);
        playClip('vo_welcome', {gain: 0.85});
      }
    }, 4000);
  }
}
els.bHelp.onclick = tutOpen;
document.getElementById('tutClose').onclick = tutClose;
document.getElementById('tutPlay').onclick = tutClose;
els.tut.addEventListener('pointerdown', function(e){ if (e.target === els.tut) tutClose(); });
(function(){
  var seen = false;
  try { seen = localStorage.getItem('lt_tut_seen') === '1'; } catch (e){}
  if (!seen && !CINE) tutOpen();   // cinematic capture never pops the tutorial
  // returning player: the tutorial never opens, so greet them by name once
  // (_welcomed is shared with tutClose's first-time shove = mutually exclusive).
  // Armed as a window, not a one-shot timer: a player who starts a mission
  // right away still gets greeted once things go idle (frameStep polls).
  else if (seen && !CINE && !_welcomed){
    _welcomed = true;
    welcomeBackAt = performance.now() + 3500;
  }
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
// mission objective tracker: gold brackets on the live target, edge arrow
// with bearing + distance when it's off-screen
function missionTarget(){
  if (missionD.stage === 'run' && missionD.cur < MD_CPS.length){
    var cpd = MD_CPS[missionD.cur];
    return {x: cpd.x, y: 3, z: cpd.z, label: 'CHECKPOINT ' + (missionD.cur + 1) + '/' + MD_CPS.length};
  }
  if (mission5.stage === 'driving' && mission5.cur < M5_CPS.length){
    var cp5 = M5_CPS[mission5.cur];
    return {x: cp5.x, y: 3, z: cp5.z, label: 'CHECKPOINT ' + (mission5.cur + 1) + '/' + M5_CPS.length};
  }
  if (mission6.stage === 'drive' && mission6.cur < M6_CPS.length){
    var cp6 = M6_CPS[mission6.cur];
    return {x: cp6.x, y: 3, z: cp6.z, label: 'SCOOP STOP ' + (mission6.cur + 1) + '/' + M6_CPS.length};
  }
  if (mission7.stage === 'tag'){
    var tent = m7NextTent();
    if (tent) return {x: tent.x, y: 3, z: tent.z,
      label: (tent.stakes ? 'DEEP STAKES ' : 'UNTAGGED CANOPY ') + (mission7.tagged + 1) + '/' + m7Tents.length};
  }
  if (mission3.stage === 'tail'){
    if (m3Car && m3Car.boarded && !m3Car.done)
      return {x: m3Car.g.position.x, y: 2.4, z: m3Car.g.position.z, label: 'GRAFT'};
    return m3Graft ? {x: m3Graft.position.x, y: 2.6, z: m3Graft.position.z, label: 'GRAFT'} : null;
  }
  if (mission3.stage === 'listen' || mission3.stage === 'photo')
    return m3Graft ? {x: m3Graft.position.x, y: 2.6, z: m3Graft.position.z, label: 'GRAFT'} : null;
  if (mission3.stage === 'scout') return {x: M3_QUAD.x, y: 3, z: M3_QUAD.z, label: 'UK QUAD'};
  if (mission3.stage === 'return') return {x: M3_TRIG.x, y: 3, z: M3_TRIG.z, label: 'THE MAYOR'};
  if (mission4.stage === 'wrangle'){
    if (m4ActiveHorse()) return {x: -228, y: 3, z: -1180, label: 'ELMENDORF PADDOCK'};
    var best = null, bd = 1e12;
    for (var k = 0; k < m4Horses.length; k++){
      var h = m4Horses[k];
      if (h.state === 'penned') continue;
      var dx = h.g.position.x - player.x, dz = h.g.position.z - player.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bd){ bd = d2; best = h; }
    }
    if (best) return {x: best.g.position.x, y: 3, z: best.g.position.z, label: best.name};
  }
  if (mission8.stage === 'wrangle'){
    // nearest foal that still needs a dart; if the stragglers are all calm
    // (walking themselves in), point at the pen instead
    var bf = null, bfd = 1e12;
    for (var q = 0; q < m8Foals.length; q++){
      var fq = m8Foals[q];
      if (fq.state !== 'loose' && fq.state !== 'bolt') continue;
      var fdx = fq.g.position.x - player.x, fdz = fq.g.position.z - player.z;
      var fd2 = fdx * fdx + fdz * fdz;
      if (fd2 < bfd){ bfd = fd2; bf = fq; }
    }
    if (bf) return {x: bf.g.position.x, y: 2.4, z: bf.g.position.z, label: 'LOOSE FOAL'};
    if (mission8.penned < 3) return {x: M8_PEN.x, y: 3, z: M8_PEN.z, label: 'THE PEN'};
  }
  if (mission9.stage === 'flying'){
    var w9 = M9_WAY[mission9.cur];
    if (w9) return {x: w9.x, y: w9.y, z: w9.z, label: (w9.pad ? 'LAND: ' : 'FLY: ') + w9.label};
  }
  return null;
}
// A single reusable objective marker: on-screen it's a bracket (or a gold
// diamond for the persistent waypoint), off-screen it clamps to a screen-edge
// arrow using camera-relative bearing math, and both carry a label + range.
// drawMissionTarget below is a thin wrapper so the live-mission path stays
// pixel-identical; opts only ADD the diamond / arrival-pulse variants.
function drawWaypointMarker(t, col, opts){
  opts = opts || {};
  var dTxt = ' · ' + Math.round(Math.hypot(t.x - player.x, t.z - player.z)) + 'M';
  var d = Math.hypot(t.x - camPos.x, t.z - camPos.z);
  var p = project(t.x, t.y, t.z);
  if (p && p[0] > 20 && p[0] < vw - 20 && p[1] > 20 && p[1] < vh - 20){
    var s = Math.max(16, Math.min(46, pxSize(3.4, d)));
    if (opts.diamond){
      var r = s / 2;
      ov.strokeStyle = col; ov.lineWidth = 1.4;
      ov.beginPath();
      ov.moveTo(p[0], p[1] - r); ov.lineTo(p[0] + r, p[1]);
      ov.lineTo(p[0], p[1] + r); ov.lineTo(p[0] - r, p[1]);
      ov.closePath(); ov.stroke();
    } else {
      bracket(p[0] - s / 2, p[1] - s / 2, s, s, col);
    }
    if (opts.pulse){
      ov.save();
      ov.globalAlpha = opts.pulse;
      ov.strokeStyle = col; ov.lineWidth = 2;
      ov.beginPath(); ov.arc(p[0], p[1], s / 2 + 4 + (1 - opts.pulse) * 14, 0, Math.PI * 2); ov.stroke();
      ov.restore();
    }
    chip(p[0] + s / 2 + 4, p[1] - s / 2 + 8, t.label + dTxt, col);
  } else {
    camera.getWorldDirection(_camDir);
    var fa = Math.atan2(_camDir.x, _camDir.z);
    var ta = Math.atan2(t.x - camPos.x, t.z - camPos.z);
    var rel = ((ta - fa + Math.PI * 3) % (Math.PI * 2)) - Math.PI;   // 0 = dead ahead
    var cx = vw / 2 + Math.sin(rel) * Math.min(vw, vh) * 0.36;
    var cy = vh / 2 - Math.cos(rel) * Math.min(vw, vh) * 0.30;
    ov.save();
    ov.translate(cx, cy);
    ov.rotate(rel);
    ov.fillStyle = col;
    ov.beginPath(); ov.moveTo(0, -11); ov.lineTo(6.5, 2); ov.lineTo(-6.5, 2); ov.closePath(); ov.fill();
    ov.restore();
    ov.font = '9.5px ui-monospace, Menlo, Consolas, monospace';
    var tw = ov.measureText(t.label + dTxt).width;
    chip(Math.max(6, Math.min(vw - tw - 10, cx - tw / 2)), cy + 18, t.label + dTxt, col);
  }
}
function drawMissionTarget(){
  var t = missionTarget();
  if (t) drawWaypointMarker(t, MISSION_COL);
}
// F1: the next unbeaten mission, mirroring nextMissionHint()'s progression.
// m5Best / M5_TRIG belong to the mission-5 island; the m5 clause is guarded
// so this stays crash-safe even if that island loads after these helpers.
function currentObjective(){
  if (!heliUnlocked) return {x: MISSION_TRIG.x, y: 9, z: MISSION_TRIG.z, label: 'THE RIBBON CUTTING'};
  if (!m2Best) return {x: DOOR_P.x, y: 13, z: DOOR_P.z, label: 'CITY HALL DOOR'};
  if (!m3Best) return {x: M3_TRIG.x, y: 9, z: M3_TRIG.z, label: 'THE DATA CENTER'};
  if (!m4Best) return {x: M4_TRIG.x, y: 9, z: M4_TRIG.z, label: 'HORSEPOWER'};
  if (typeof m5Best !== 'undefined' && !m5Best && typeof M5_TRIG !== 'undefined')
    return {x: M5_TRIG.x, y: 9, z: M5_TRIG.z, label: 'DEADLINE'};
  if (typeof m6Best !== 'undefined' && !m6Best && typeof M6_TRIG !== 'undefined')
    return {x: M6_TRIG.x, y: 9, z: M6_TRIG.z, label: 'THE MELT'};
  if (typeof m7Best !== 'undefined' && !m7Best && typeof M7_TRIG !== 'undefined')
    return {x: M7_TRIG.x, y: 9, z: M7_TRIG.z, label: 'TAILGATE COMPLIANCE'};
  if (typeof m8Best !== 'undefined' && !m8Best && typeof M8_TRIG !== 'undefined')
    return {x: M8_TRIG.x, y: 9, z: M8_TRIG.z, label: 'LOOSE IN THE PADDOCK'};
  if (typeof m9Best !== 'undefined' && !m9Best && typeof M9_TRIG !== 'undefined')
    return {x: M9_TRIG.x, y: 9, z: M9_TRIG.z, label: 'AIR MAIL'};
  if (typeof missionD !== 'undefined' && (!dailyBest || dailyBest.day !== dayIndex()))
    return {x: MD_TRIG.x, y: 9, z: MD_TRIG.z, label: 'THE DASH'};
  return null;
}
// F1: persistent gold diamond pointing at the current objective plus a
// first-session banner. Defers to drawMissionTarget during any live mission
// (all camera modes) and honors the WAYPT toggle. Pure local overlay.
var objArriveAt = 0;
function drawObjectiveWaypoint(){
  if (!show.waypt || !allIdle()) return;
  var o = currentObjective();
  if (!o) return;
  var dist = Math.hypot(o.x - player.x, o.z - player.z);
  var pulse = 0;
  if (dist < 15){
    if (!objArriveAt) objArriveAt = performance.now();
    var pl = performance.now() - objArriveAt;
    if (pl < 700) pulse = 1 - pl / 700;
    if (!objBannerDone){
      objBannerDone = true;
      try { localStorage.setItem('lt_obj_banner_seen', '1'); } catch (e){}
    }
  } else {
    objArriveAt = 0;
  }
  drawWaypointMarker(o, MISSION_COL, {diamond: true, pulse: pulse});
  if (!objBannerDone){
    var bTxt = 'OBJECTIVE - ' + o.label;
    ov.font = '12px ui-monospace, Menlo, Consolas, monospace';
    var bw = ov.measureText(bTxt).width;
    ov.fillStyle = 'rgba(2,8,10,0.62)';
    ov.fillRect(vw / 2 - bw / 2 - 8, 12, bw + 16, 20);
    ov.fillStyle = MISSION_COL;
    ov.fillText(bTxt, vw / 2 - bw / 2, 26);
  }
}
// F4a: during the wrangle, mark every un-penned horse so players learn there
// are three and where they scattered (reuses the F1 marker primitive).
function drawM4HorseArrows(){
  if (mission4.stage !== 'wrangle') return;
  for (var k = 0; k < m4Horses.length; k++){
    var h = m4Horses[k];
    if (h.state === 'penned') continue;
    drawWaypointMarker({x: h.g.position.x, y: 3, z: h.g.position.z, label: h.name}, MISSION_COL);
  }
}
var camPos = new THREE.Vector3();
function drawOverlay(){
  ov.clearRect(0, 0, vw, vh);
  if (CINE){ if (cine.bars) cineLetterbox(); return; }   // trailer: nothing but the 3D world (+ optional bars)
  if (photo.active){   // Photo Mode: bars + optional tags, no HUD chrome (mirrors the CINE strip)
    if (photo.bars) cineLetterbox();
    if (photo.tags) drawPhotoTags();
    if (performance.now() < photo.flashUntil){   // shutter flash — set post-capture, so never baked into the shot
      ov.save();
      ov.globalAlpha = Math.max(0, Math.min(1, (photo.flashUntil - performance.now()) / 140));
      ov.fillStyle = '#fff'; ov.fillRect(0, 0, vw, vh);
      ov.restore();
    }
    return;
  }
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
      chip(mTag[0] - ov.measureText(mTxt).width / 2, mTag[1], mTxt, MISSION_COL);
    }
  }
  var tTxt = null;
  if (mission.stage === 'fight')
    tTxt = 'THE RIBBON CUTTING · ' + ((performance.now() - mission.t0f) / 1000).toFixed(1) + 's';
  else if (mission2.stage === 'plow' && mission2.t0)
    tTxt = 'SNOW EMERGENCY · ' + ((performance.now() - mission2.t0) / 1000).toFixed(1) + 's' +
      (mission2.penalty ? ' · +' + mission2.penalty + 's PENALTY' : '');
  else if (mission5.stage === 'driving')
    tTxt = 'DEADLINE · CP ' + Math.min(mission5.cur + 1, M5_CPS.length) + '/' + M5_CPS.length + ' · ' +
      Math.max(0, Math.ceil(M5_BUDGET - (performance.now() - mission5.t0) / 1000)) + 's';
  else if (missionD.stage === 'run')
    tTxt = 'DAILY DASH · CP ' + Math.min(missionD.cur + 1, MD_N) + '/' + MD_N + ' · ' +
      ((performance.now() - missionD.t0) / 1000).toFixed(1) + 's';
  if (tTxt){   // mission timer, top center
    ov.font = '12px ui-monospace, Menlo, Consolas, monospace';
    var tw3 = ov.measureText(tTxt).width;
    ov.fillStyle = 'rgba(2,8,10,0.62)';
    ov.fillRect(vw / 2 - tw3 / 2 - 8, 12, tw3 + 16, 20);
    ov.fillStyle = MISSION_COL;
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
      chip(zp[0] - 24, zp[1], zn.name + ' ' + pct + '%', MISSION_COL);
    }
    if (plowVeh && player.veh !== plowVeh){
      var pv = project(plowVeh.g.position.x, plowVeh.g.position.y + 4, plowVeh.g.position.z);
      if (pv) chip(pv[0] - 26, pv[1], 'SNOW PLOW', MISSION_COL);
    }
    var rp2 = project((REDDIT_ZONE.lo + REDDIT_ZONE.hi) / 2, 4, REDDIT_ZONE.c);
    if (rp2) chip(rp2[0] - 52, rp2[1], "MAYOR'S ST — DO NOT PLOW", '#ff5f52');
  }
  // NPC cars and pedestrians carry no HUD — detection boxes/tracks are
  // reserved for players (show.box below) and mission objects.
  // player name tags + chat bubbles + detection boxes for players — only
  // within 100 m so the HUD stays readable in a crowd
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
      // 100 m proximity gate, measured from the avatar (not the camera —
      // the drone/orbit rig flies hundreds of meters up and would hide
      // every tag). Screen sizing below still uses camera distance.
      var pdx = pos.x - player.x, pdy = pos.y - player.y, pdz = pos.z - player.z;
      if (pdx * pdx + pdy * pdy + pdz * pdz > 100 * 100) continue;
      var dist = camPos.distanceTo(pos);
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
    var midMission = !allIdle();
    for (k = 0; k < labels.length; k++){
      var lb = labels[k];
      if (lb.mission && midMission) continue;
      var d3 = camPos.distanceTo(_v.set(lb.x, lb.y, lb.z));
      if (d3 > 1300) continue;
      var lp = project(lb.x, lb.y, lb.z);
      if (!lp) continue;
      ov.strokeStyle = lb.col ? 'rgba(255,210,138,0.6)' : 'rgba(110,247,223,0.55)'; ov.lineWidth = 1;
      ov.beginPath(); ov.moveTo(lp[0], lp[1]); ov.lineTo(lp[0], lp[1] - 16); ov.stroke();
      ov.fillStyle = lb.col || '#6ef7df';
      ov.fillRect(lp[0] - 1.5, lp[1] - 1.5, 3, 3);
      chip(lp[0] + 4, lp[1] - 18, lb.name, lb.col || '#d9fff6');
    }
  }
  drawMissionTarget();
  drawObjectiveWaypoint();
  drawM4HorseArrows();
}

// ---------- route ribbon + destination beacon (street-graph wayfinding) ----------
// A glowing gold GTA-style route drawn along the REAL street grid from the
// player to the current wayfinding target, plus a tall light pillar at the
// destination so it reads over the skyline. Both obey the WAYPT toggle / #wp=0
// and hide in cinematic mode (#cine=1); pure client-side so they work offline /
// bots-only. The straight-line diamond marker still draws on top as the
// distance readout — this only adds the on-street route + the beacon under it.
//
// The street graph is built ONCE at boot from the EW/NS tables: nodes are the
// intersections (meets(e,n)); edges join CONSECUTIVE intersections along each
// street, so there is never an edge across a gap where a street doesn't exist
// (partial-extent streets like Rose/MLK/Upper simply have fewer intersections).
// The New Circle beltline legs are ordinary EW/NS rows, so their corner joins
// fall straight out of the same consecutive-intersection rule. One-way street
// directions are IGNORED here: pedestrians aren't bound by them and m5 drivers
// read the painted road arrows, so every edge is bidirectional — no directed
// edges, which keeps v1 simple.
var RIBBON_COL = 0xffcf3a;   // gold, same family as the star mission gold
var RIBBON_Y = 0.24;         // just above the road markings, below the cars
var RIBBON_W = 1.9;          // ribbon width (m)
var BEACON_H = 130;          // destination light-pillar height (m)
var DASH_PERIOD = 16;        // metres per flowing pulse along the ribbon

var rrNodes = [];   // {x, z} intersection points
var rrAdj = [];     // rrAdj[i] = [{to, w}, ...] adjacency (bidirectional)
var rrEdges = [];   // {a, b} node-index pairs (for nearest-segment projection)
(function buildStreetGraph(){
  var key = {};
  function nodeAt(x, z){
    var k = x + '|' + z;
    if (key[k] === undefined){ key[k] = rrNodes.length; rrNodes.push({x: x, z: z}); rrAdj.push([]); }
    return key[k];
  }
  function link(a, b){
    if (a === b) return;
    var w = Math.hypot(rrNodes[a].x - rrNodes[b].x, rrNodes[a].z - rrNodes[b].z);
    rrAdj[a].push({to: b, w: w});
    rrAdj[b].push({to: a, w: w});
    rrEdges.push({a: a, b: b});
  }
  EW.forEach(function(e){   // horizontal runs: intersections sorted west->east
    var xs = [];
    NS.forEach(function(n){ if (meets(e, n)) xs.push(n.x); });
    xs.sort(function(p, q){ return p - q; });
    for (var i = 0; i < xs.length; i++){
      if (i > 0) link(nodeAt(xs[i - 1], e.z), nodeAt(xs[i], e.z));
      else nodeAt(xs[i], e.z);
    }
  });
  NS.forEach(function(n){   // vertical runs: intersections sorted north->south
    var zs = [];
    EW.forEach(function(e){ if (meets(e, n)) zs.push(e.z); });
    zs.sort(function(p, q){ return p - q; });
    for (var i = 0; i < zs.length; i++){
      if (i > 0) link(nodeAt(n.x, zs[i - 1]), nodeAt(n.x, zs[i]));
      else nodeAt(n.x, zs[i]);
    }
  });
  if (/debug=1/.test(hashStr)) console.log('[route] graph nodes', rrNodes.length, 'edges', rrEdges.length);
})();

// nearest point on the nearest street SEGMENT to (px,pz): so the ribbon starts
// and ends on the road beside you, not at a block-distant node.
function rrNearestSeg(px, pz){
  var bestD2 = Infinity, res = null;
  for (var i = 0; i < rrEdges.length; i++){
    var ed = rrEdges[i];
    var ax = rrNodes[ed.a].x, az = rrNodes[ed.a].z;
    var dx = rrNodes[ed.b].x - ax, dz = rrNodes[ed.b].z - az;
    var len2 = dx * dx + dz * dz;
    var t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = ax + t * dx, cz = az + t * dz;
    var ex = px - cx, ez = pz - cz, d2 = ex * ex + ez * ez;
    if (d2 < bestD2){ bestD2 = d2; res = {x: cx, z: cz, a: ed.a, b: ed.b}; }
  }
  return res;
}
// Dijkstra from the road point beside the player to the road point beside the
// target, over the intersection graph augmented with two virtual endpoints S/T
// (so the projected start/end points route through the real nodes). Graph is a
// few hundred nodes, so a plain linear-scan Dijkstra is well under budget.
// Returns a polyline [startRoadPoint, ...intersections..., endRoadPoint] or null.
function rrCompute(px, pz, tx, tz){
  if (rrEdges.length === 0) return null;
  var s = rrNearestSeg(px, pz), t = rrNearestSeg(tx, tz);
  if (!s || !t) return null;
  var N = rrNodes.length, S = N, T = N + 1;
  var sameSeg = (s.a === t.a && s.b === t.b) || (s.a === t.b && s.b === t.a);
  var sa = Math.hypot(s.x - rrNodes[s.a].x, s.z - rrNodes[s.a].z);
  var sb = Math.hypot(s.x - rrNodes[s.b].x, s.z - rrNodes[s.b].z);
  var ta = Math.hypot(t.x - rrNodes[t.a].x, t.z - rrNodes[t.a].z);
  var tb = Math.hypot(t.x - rrNodes[t.b].x, t.z - rrNodes[t.b].z);
  var dist = [], prev = [], done = [];
  for (var i = 0; i < N + 2; i++){ dist[i] = Infinity; prev[i] = -1; done[i] = false; }
  dist[S] = 0;
  function relax(u, v, w){ var nd = dist[u] + w; if (nd < dist[v]){ dist[v] = nd; prev[v] = u; } }
  while (true){
    var u = -1, best = Infinity;
    for (var j = 0; j < N + 2; j++){ if (!done[j] && dist[j] < best){ best = dist[j]; u = j; } }
    if (u === -1 || u === T) break;
    done[u] = true;
    if (u === S){
      relax(S, s.a, sa); relax(S, s.b, sb);
      if (sameSeg) relax(S, T, Math.hypot(s.x - t.x, s.z - t.z));
    } else {
      var al = rrAdj[u];
      for (var q = 0; q < al.length; q++) relax(u, al[q].to, al[q].w);
      if (u === t.a) relax(u, T, ta);
      if (u === t.b) relax(u, T, tb);
    }
  }
  if (dist[T] === Infinity) return null;
  var seq = [], cur = prev[T];
  while (cur !== -1 && cur !== S){ seq.push(cur); cur = prev[cur]; }
  seq.reverse();
  var pts = [{x: s.x, z: s.z}];
  for (var r = 0; r < seq.length; r++) pts.push({x: rrNodes[seq[r]].x, z: rrNodes[seq[r]].z});
  pts.push({x: t.x, z: t.z});
  return pts;
}
// unit normal (perp to travel) in XZ
function rrPerp(dx, dz){ var l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l]; }
// One triangle-strip mesh for the whole polyline (plain THREE.Line is 1px in
// r147 UMD — no Line2/jsm — so we build fat quads with mitred corners). UVs run
// as world-distance / DASH_PERIOD along the length so a scrolling texture reads
// as flow toward the destination. Rebuilt only on recompute, never per-frame.
function rrBuildGeometry(pts){
  var p = [];
  for (var i = 0; i < pts.length; i++){
    if (i === 0 || Math.hypot(pts[i].x - p[p.length - 1].x, pts[i].z - p[p.length - 1].z) > 0.4) p.push(pts[i]);
  }
  if (p.length < 2) return null;
  var half = RIBBON_W * 0.5;
  var verts = [], uvs = [], idx = [], cum = 0;
  for (var i2 = 0; i2 < p.length; i2++){
    var mx, mz;
    if (i2 === 0){ var n0 = rrPerp(p[1].x - p[0].x, p[1].z - p[0].z); mx = n0[0]; mz = n0[1]; }
    else if (i2 === p.length - 1){ var n1 = rrPerp(p[i2].x - p[i2 - 1].x, p[i2].z - p[i2 - 1].z); mx = n1[0]; mz = n1[1]; }
    else {
      var ni = rrPerp(p[i2].x - p[i2 - 1].x, p[i2].z - p[i2 - 1].z);
      var no = rrPerp(p[i2 + 1].x - p[i2].x, p[i2 + 1].z - p[i2].z);
      var sx = ni[0] + no[0], sz = ni[1] + no[1], sl = Math.hypot(sx, sz);
      if (sl < 0.001){ mx = ni[0]; mz = ni[1]; }
      else { var mux = sx / sl, muz = sz / sl, c = mux * ni[0] + muz * ni[1], sc = c > 0.25 ? 1 / c : 4; mx = mux * sc; mz = muz * sc; }
    }
    if (i2 > 0) cum += Math.hypot(p[i2].x - p[i2 - 1].x, p[i2].z - p[i2 - 1].z);
    var u = cum / DASH_PERIOD;
    verts.push(p[i2].x + mx * half, RIBBON_Y, p[i2].z + mz * half);
    verts.push(p[i2].x - mx * half, RIBBON_Y, p[i2].z - mz * half);
    uvs.push(u, 0, u, 1);
  }
  for (var k = 0; k < p.length - 1; k++){
    var a = k * 2, b = k * 2 + 1, cc = (k + 1) * 2, d = (k + 1) * 2 + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}
var rrDashTex = makeTex(64, 8, function(g, w, h){
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(205,205,205,0.82)';   // base -> tinted gold by material.color
  g.fillRect(0, 0, w, h);
  var grad = g.createLinearGradient(0, 0, w, 0);   // one bright pulse per tile
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, 'rgba(255,255,255,0)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
});
rrDashTex.wrapT = THREE.ClampToEdgeWrapping;
var ribbonMat = new THREE.MeshBasicMaterial({color: RIBBON_COL, map: rrDashTex,
  transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide});
var ribbonMesh = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat);
ribbonMesh.frustumCulled = false; ribbonMesh.renderOrder = 3; ribbonMesh.visible = false;
scene.add(ribbonMesh);
var beaconMat = new THREE.MeshBasicMaterial({color: RIBBON_COL, transparent: true,
  opacity: 0.16, depthWrite: false, depthTest: false, side: THREE.DoubleSide});
var beaconMesh = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, BEACON_H, 18, 1, true), beaconMat);
beaconMesh.position.y = BEACON_H / 2; beaconMesh.renderOrder = 999; beaconMesh.visible = false;
scene.add(beaconMesh);
// One target for BOTH ribbon and beacon, mirroring the overlay marker
// precedence exactly (drawMissionTarget vs drawObjectiveWaypoint): the
// persistent objective when everything is idle, else the live mission's target
// (m5 checkpoints, m3 tail, m4 horses, ...). Either may be null (all missions
// beaten, or a mission stage with no single point), in which case the ribbon +
// beacon hide just like the diamond does.
function routeTarget(){
  return allIdle() ? currentObjective() : missionTarget();
}
var rrLast = {tx: null, tz: null, px: 0, pz: 0, at: 0, has: false};
function rrRecompute(t){
  var pts = rrCompute(player.x, player.z, t.x, t.z);
  var g = pts ? rrBuildGeometry(pts) : null;
  ribbonMesh.geometry.dispose();
  ribbonMesh.geometry = g || new THREE.BufferGeometry();
  ribbonMesh.visible = !!g;
  rrLast.tx = t.x; rrLast.tz = t.z; rrLast.px = player.x; rrLast.pz = player.z;
  rrLast.at = performance.now(); rrLast.has = !!g;
}
function updateRouteRibbon(dt){
  var t = (show.waypt && !CINE) ? routeTarget() : null;
  if (!t){ ribbonMesh.visible = false; beaconMesh.visible = false; return; }
  var now = performance.now();
  // destination beacon: move to target, gentle pulse, fade out up close so it
  // isn't blinding once the ring + hint take over from ~25 m in.
  beaconMesh.position.set(t.x, BEACON_H / 2, t.z);
  var d = Math.hypot(t.x - player.x, t.z - player.z);
  var near = d < 25 ? Math.max(0, (d - 6) / 19) : 1;
  beaconMat.opacity = (0.10 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.004))) * near;
  beaconMesh.visible = near > 0.01;
  // ribbon: scroll the dash every frame (cheap); rebuild geometry only per the
  // recompute policy — target moved, player moved >20 m, or >3 s stale — and
  // never more often than ~3x/s so a fast-moving target can't thrash Dijkstra.
  rrDashTex.offset.x = (rrDashTex.offset.x - dt * 0.5) % 1;
  var moved = Math.hypot(player.x - rrLast.px, player.z - rrLast.pz);
  var tgtMoved = rrLast.tx === null || Math.hypot(t.x - rrLast.tx, t.z - rrLast.tz) > 1.5;
  var due = tgtMoved || moved > 20 || (now - rrLast.at) > 3000;
  if (due && (rrLast.tx === null || now - rrLast.at > 320)) rrRecompute(t);
  else if (rrLast.has) ribbonMesh.visible = true;
}
if (window.__lt){   // dev hook (only under #debug=1): inspect the route graph
  window.__lt.route = {ribbon: ribbonMesh, beacon: beaconMesh, nodes: rrNodes,
    edges: rrEdges, target: routeTarget, compute: rrCompute, last: rrLast};
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
  frameStep(now);
}
function frameStep(now){
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused){
    simH = (simH + dt * speed / 3600) % 24;
    simT += dt;
    updateCars(dt, simT);
    updatePeds(dt, simT);
  }
  updateWeather(dt);   // wall-clock ambient weather - deliberately runs while paused too
  updateBus(dt);       // wall-clock loop bus - deterministic, also runs while paused
  updatePlayer(dt);
  updateDarts(dt);
  runBots(dt);
  updateRemotes(dt);
  updateRideAlong(dt);   // pin the passenger to the bound driver's seat BEFORE netTick/cam read player pos
  updateBusRide(dt);     // same, for a loop-bus passenger's deterministic seat
  updateHeli(dt);
  updateMission(dt);
  updateMission2(dt);
  updateMission3(dt);
  updateMission4(dt);
  updateMission5(dt);
  updateMission6(dt);
  updateMission7(dt);
  updateMission8(dt);
  updateMission9(dt);
  updateMissionD(dt);
  updateRouteRibbon(dt);
  updateRockets(dt);
  updateDrops(dt);
  updatePuffs(dt);
  updatePickups(dt);
  updateRotorSnd();
  updateAssetAudio(dt);
  netTick(dt);
  diagTick(dt);
  if (cine.active){
    updateCineCam(dt);   // scripted trailer camera takes over while running
  } else if (mode === 'drone'){
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
  if (wxGrey > 0.01){   // ambient weather blend (idle whenever the storm is up)
    // scaled by (1 - m2Sky) so the mission storm's sky WINS during the ~15s
    // overlap while weather eases out — multiplying both cuts over-darkens
    var wxW = 1 - m2Sky;
    skyC.lerp(_wxCol, wxGrey * wxW);
    fogC.lerp(_wxCol, wxGrey * wxW);
    env.sun *= 1 - (1 - wxSun) * wxW;
    env.hemi += (0.5 - env.hemi) * (0.35 * wxGrey * wxW);
  }
  renderer.setClearColor(skyC);
  scene.fog.color.copy(fogC);
  scene.fog.density = Math.min(0.003, 0.0007 + env.night * 0.00045 + m2Sky * 0.0012 + wxFog * 0.0016);
  hemi.color.copy(skyC); hemi.intensity = env.hemi;
  var sa = (simH - 6) / 12 * Math.PI;
  sun.position.set(-Math.cos(sa) * 600, Math.max(30, Math.sin(sa) * 500), 220);
  sun.intensity = env.sun;
  if (wxFlash > 0.01) sun.intensity += wxFlash * 2.5;   // lightning flash (F3)
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
  if (els.wx){ var ww = wxCurState.toUpperCase(); if (ww !== _wxWord){ _wxWord = ww; els.wx.textContent = ww; } }
  var hint = '';
  if (mode === 'player'){
    if (isFrozen()) hint = 'FROZEN' + (frozenByName ? ' BY ' + frozenByName : '') + ' — ' + Math.ceil((player.frozenUntil - performance.now()) / 1000) + 's';
    else if (player.bus !== null) hint = 'THE LOOP — NEXT: ' + BUS_STOPS[busStateAt(Date.now()).nextStopIdx].name + ' · E — HOP OUT · R — RADIO';
    else if (player.ride) hint = 'E — HOP OUT · R — RADIO · C — VIEW';
    else if (player.scoot) hint = 'E — HOP OFF · W/S THROTTLE · A/D STEER · ' + Math.round(Math.abs(player.scoot.spd) * 3.6) + ' KM/H';
    else if (missionFight()) hint = 'SHOOT DOWN THE CHOPPER · F/CLICK — FIRE · RMB — AIM · CHOPPER HP ' + mh.hp + '/3';
    else if (player.heli) hint = 'W/S A/D FLY · SPACE UP · SHIFT DOWN · HOLD F/CLICK — WATER CANNON · E — EXIT · HP ' + heli.hp + '/3';
    else if (player.veh && player.veh.plow) hint = 'BLADE: ' + (bladeDown ? 'DOWN' : 'UP') + ' · SPACE — RAISE/LOWER · CLEAR THE SNOWY STREETS · E — EXIT';
    else if (mission5.stage === 'driving'){
      hint = 'DEADLINE · CP ' + (mission5.cur + 1) + '/' + M5_CPS.length + ' · ' + Math.max(0, Math.ceil(M5_BUDGET - (performance.now() - mission5.t0) / 1000)) + 's LEFT';
      // split delta vs your best run (green/red is a whole-line pulse below - #hint
      // is one color element, so the AHEAD/BEHIND word carries the sign unambiguously)
      if (ghost && ghostEnabled && ghostDelta !== null) hint += ' · ' + (ghostDelta <= 0 ? 'AHEAD ' : 'BEHIND ') + Math.abs(ghostDelta).toFixed(1) + 's';
    }
    else if (mission6.stage === 'drive') hint = 'THE MELT · STOP ' + (mission6.cur + 1) + '/' + M6_CPS.length + ' · MELT ' + Math.min(99, Math.max(0, Math.round(m6MeltSec() / M6_BUDGET * 100))) + '% · CRASHES MELT IT FASTER';
    else if (missionD.stage === 'run') hint = 'DAILY DASH · CHECKPOINT ' + (missionD.cur + 1) + '/' + MD_N + ' · NEXT: ' + MD_CPS[missionD.cur].name + ' · ' + ((performance.now() - missionD.t0) / 1000).toFixed(1) + 's · ANY WHEELS';
    else if (player.veh) hint = 'E — EXIT · W/S DRIVE · A/D STEER · ' + Math.round(Math.abs(player.veh.spd) * 3.6) + ' KM/H';
    else if (mission2.stage === 'plow' && plowVeh) hint = 'GET TO THE PLOW — MAIN ST BY CITY HALL (E TO BOARD)';
    else if (mission3.stage === 'tail') hint = 'TAIL THE COUNCILMAN — STAY BACK, STAY CLOSE ENOUGH';
    else if (mission3.stage === 'listen') hint = 'EAVESDROP BEHIND AL\'S — CLOSE ENOUGH TO HEAR, NOT CLOSER';
    else if (mission3.stage === 'scout') hint = 'GET TO THE UK QUAD — TEAL RING';
    else if (mission3.stage === 'photo') hint = 'F/CLICK — PHOTO (' + mission3.photos + '/3) · DON\'T GET CLOSE';
    else if (mission3.stage === 'return') hint = 'BRING THE PHOTOS TO THE MAYOR — PHOENIX PARK';
    else if (mission4.stage === 'wrangle' && calmableHorse()) hint = 'E — TAKE THE LEAD ROPE';
    else if (mission4.stage === 'wrangle') hint = 'HORSES HOME: ' + mission4.penned + '/3 · SNEAK UP SLOW · GREEN RING AT ELMENDORF';
    else if (mission7.stage === 'tag') hint = 'TAILGATE COMPLIANCE · TAGGED ' + mission7.tagged + '/' + m7Tents.length + ' · KICKOFF ' + Math.max(0, Math.ceil(M7_BUDGET - (performance.now() - mission7.t0) / 1000)) + 's · STAND BY A CANOPY TO TAG';
    else if (mission8.stage === 'wrangle') hint = 'LOOSE IN THE PADDOCK · PENNED ' + mission8.penned + '/3 · ' + Math.max(0, Math.ceil(M8_BUDGET - (performance.now() - mission8.t0) / 1000)) + 's · F/CLICK — DART A FOAL';
    else if (mission9.stage === 'flying') hint = 'AIR MAIL · STOP ' + (mission9.cur + 1) + '/' + M9_WAY.length + ' · FUEL ' + Math.round(player.fuel) + '% · ' + Math.max(0, Math.ceil(M9_BUDGET - (performance.now() - mission9.t0) / 1000)) + 's LEFT';
    else if (allIdle() && nearMissionTrig()) hint = 'E — START MISSION: THE RIBBON CUTTING';
    else if (heliUnlocked && allIdle() && nearDoor()) hint = 'E — CITY HALL: SEE THE MAYOR';
    else if (!heliUnlocked && nearDoor()) hint = 'CITY HALL IS LOCKED — BEAT "THE RIBBON CUTTING" FIRST';
    else if (allIdle() && nearM3Trig()) hint = 'E — START MISSION: THE DATA CENTER';
    else if (allIdle() && nearM4Trig()) hint = 'E — START MISSION: HORSEPOWER';
    else if (allIdle() && nearM5Trig()) hint = 'E — START MISSION: DEADLINE';
    else if (allIdle() && nearM6Trig()) hint = 'E — START MISSION: THE MELT';
    else if (allIdle() && nearM7Trig()) hint = 'E — START MISSION: TAILGATE COMPLIANCE';
    else if (allIdle() && nearM8Trig()) hint = 'E — START MISSION: LOOSE IN THE PADDOCK';
    else if (allIdle() && nearM9Trig()) hint = 'E — START MISSION: AIR MAIL';
    else if (allIdle() && nearMDTrig()) hint = 'E — START THE DAILY DASH';
    else if (canEnterHeli()) hint = 'E — FLY THE NEWS CHOPPER';
    else if (!heliUnlocked && canEnterHeliBase()) hint = 'LOCKED — BEAT "THE RIBBON CUTTING" AT CITY HALL TO FLY';
    else if (canBoardBus()) hint = 'DOORS OPEN — E TO BOARD THE LOOP';
    else if (player.grounded && canRideShotgun()) hint = 'E — RIDE SHOTGUN';
    else if (player.grounded && nearestVehicle()) hint = 'E — ENTER CAR';
    else if (!player.grounded && player.thrusting) hint = 'JETPACK · FUEL ' + Math.round(player.fuel) + '%';
    else if (myRpg > 0 && heliActive()) hint = 'RPG ×' + myRpg + ' · F/CLICK — FIRE AT THE CHOPPER · RMB — AIM';
    else if (player.pvp) hint = 'CLICK/F — FIRE · RMB — AIM · G — HOLSTER';
    else {
      var bwh = busWaitHint();   // one call per frame — it rescans stops + the timeline
      if (bwh) hint = bwh;       // 'BUS IN m:ss — NAME' at a stop
      else if (allIdle()) hint = nextMissionHint();
    }
  }
  // one-time discoverability tip, fired only when the feature is actually usable
  // (a live human is driving within range) - never repeats across sessions
  if (!rideTipShown && canRideShotgun()){
    rideTipShown = true;
    try { localStorage.setItem('lt_ride_seen', '1'); } catch (e){}
    caption('TIP', "walk up to a car someone's driving and press E to ride along", 4000);
  }
  // returning-player greeting: polls (like the ride tip) instead of a one-shot
  // timer so a player who dives straight into a mission still gets greeted
  // when things go idle; gives up quietly after ~20s
  if (welcomeBackAt){
    var wbNow = performance.now();
    if (wbNow > welcomeBackAt + 20000) welcomeBackAt = 0;
    else if (wbNow > welcomeBackAt && allIdle()){
      welcomeBackAt = 0;
      caption('DISPATCH', welcomeBackLine(), 6500);
    }
  }
  els.hint.textContent = hint;
  els.hint.style.display = hint ? 'block' : 'none';
  // ghost split pulse: flash the whole hint line green (ahead) / red (behind) for a
  // beat at each checkpoint, reverting to the default color otherwise
  els.hint.style.color = (mode === 'player' && performance.now() < ghostPulseUntil) ? (ghostPulseAhead ? '#5dffa0' : '#ff6a5a') : '';

  renderer.render(scene, camera);
  drawOverlay();
  if (captureNext){ captureNext = false; photoCapture(); }   // grab-next-frame: buffer still valid here
}
requestAnimationFrame(frame);
})();

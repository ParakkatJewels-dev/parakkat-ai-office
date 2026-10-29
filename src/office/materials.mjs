// Architectural finishes for the interactive campus. Drawn once, then shared by every
// room so the static scene can still merge to one draw per material. No image service
// or network request is needed to render the map.

export function createCampusMaterials({ THREE, tex, rnd = Math.random }) {
  let seed = Math.max(1, Math.floor(rnd() * 2147483646));
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const textures = new Set(), materialSet = new Set();
  const makeTexture = (draw, w = 512, h = 512, repeat = [3, 3], data = false) => {
    const texture = tex(draw, w, h, repeat);
    // Bump/roughness maps carry scalar data, not sRGB colour.
    if (data) texture.encoding = THREE.LinearEncoding;
    textures.add(texture);
    return texture;
  };
  const makeMaterial = options => {
    const material = new THREE.MeshStandardMaterial(options);
    materialSet.add(material);
    return material;
  };
  const shade = (base, delta) => {
    const n = parseInt(base.slice(1), 16);
    const channel = shift => Math.max(0, Math.min(255, ((n >> shift) & 255) + delta));
    return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
  };
  const speckle = (g, w, h, count, alpha = .04, size = 1.2) => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = random() > .5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      g.fillRect(random() * w, random() * h, size, size);
    }
  };

  // Long staggered planks, fine sweeping grain and a bevel just wide enough to read
  // in the overview without turning the floor into a high-contrast grid.
  function wood(base) {
    return makeTexture((g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const rowH = 32, span = 256;
      for (let y = 0, row = 0; y < h; y += rowH, row++) {
        const offset = [0, 87, 173, 44][row % 4];
        for (let x = offset - span; x < w; x += span) {
          const tone = (random() - .5) * 17;
          g.fillStyle = shade(base, tone); g.fillRect(x, y, span, rowH);
          g.save(); g.beginPath(); g.rect(x + 1, y + 1, span - 2, rowH - 2); g.clip();
          const knotX = x + random() * span, knotY = y + rowH * (.2 + random() * .6);
          for (let line = 0; line < 28; line++) {
            const yy = y + random() * rowH, bend = (random() - .5) * 3;
            g.strokeStyle = random() > .3 ? 'rgba(66,38,17,.10)' : 'rgba(255,238,204,.16)';
            g.lineWidth = .35 + random() * .65; g.beginPath();
            for (let px = x; px <= x + span; px += 8) {
              const nearKnot = Math.exp(-Math.pow((px - knotX) / 28, 2));
              const py = yy + Math.sin((px - x) / 58 + line) * .9 + nearKnot * (yy < knotY ? -1 : 1) * bend;
              if (px === x) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.stroke();
          }
          if (random() > .78) {
            g.strokeStyle = 'rgba(75,40,21,.12)'; g.lineWidth = .7;
            g.beginPath(); g.ellipse(knotX, knotY, 9, 1.8, 0, 0, Math.PI * 2); g.stroke();
          }
          g.restore();
          g.fillStyle = 'rgba(60,39,24,.25)'; g.fillRect(x, y, .8, rowH); g.fillRect(x, y, span, .8);
          g.fillStyle = 'rgba(255,242,220,.20)'; g.fillRect(x + 1, y + 1, span - 2, .6);
        }
      }
      speckle(g, w, h, 3500, .025, .8);
    });
  }

  function tile(base, divisions, stoneVeins = false, repeat = [3, 3]) {
    return makeTexture((g, w, h) => {
      const step = w / divisions;
      g.fillStyle = '#b9b3a8'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
        g.fillStyle = shade(base, (random() - .5) * 9); g.fillRect(x + .8, y + .8, step - 1.6, step - 1.6);
        g.save(); g.beginPath(); g.rect(x + 1, y + 1, step - 2, step - 2); g.clip();
        if (stoneVeins) {
          for (let n = 0; n < 3; n++) {
            const start = y + random() * step;
            g.beginPath(); g.moveTo(x - 2, start);
            g.bezierCurveTo(x + step * .28, start - step * .3, x + step * .58, start + step * .32, x + step + 2, start + step * .12);
            g.strokeStyle = 'rgba(121,117,110,.09)'; g.lineWidth = 1 + random() * 2; g.stroke();
            g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = .5; g.stroke();
          }
        }
        const sheen = g.createLinearGradient(x, y, x + step, y + step);
        sheen.addColorStop(0, 'rgba(255,255,255,.06)'); sheen.addColorStop(1, 'rgba(80,71,56,.025)');
        g.fillStyle = sheen; g.fillRect(x, y, step, step); g.restore();
        g.fillStyle = 'rgba(255,255,255,.30)'; g.fillRect(x + 1, y + 1, step - 2, .7);
      }
      speckle(g, w, h, 6500, .025, 1);
    }, 512, 512, repeat);
  }

  const woodMap = wood('#ad7951'), oakMap = wood('#c8a173');
  const concreteMap = tile('#deddd7', 4), marbleMap = tile('#eeeae2', 3, true);
  const carpetMap = makeTexture((g, w, h) => {
    g.fillStyle = '#38454c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const cross = ((x / 64 | 0) + (y / 64 | 0)) % 2;
      g.fillStyle = shade('#38454c', (random() - .5) * 18 + cross * 3);
      g.fillRect(x, y, cross ? 1 : 2, cross ? 2 : 1);
    }
    g.fillStyle = 'rgba(9,18,23,.12)';
    for (let p = 0; p < w; p += 128) { g.fillRect(p, 0, .65, h); g.fillRect(0, p, w, .65); }
  }, 256, 256, [5, 5]);

  // Low amplitude surface relief stays inexpensive, with one shared map for the
  // mineral finishes. The diffuse map provides the large-scale seams and veining.
  const mineralRelief = makeTexture((g, w, h) => {
    g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, w, h); speckle(g, w, h, 10500, .15, 1);
  }, 256, 256, [3, 3], true);
  const woodRelief = makeTexture((g, w, h) => {
    g.fillStyle = '#bababa'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      g.fillStyle = `rgba(40,40,40,${random() * .17})`;
      g.fillRect(random() * 35, y, w, .45);
    }
    for (let y = 0; y < h; y += 16) { g.fillStyle = '#858585'; g.fillRect(0, y, w, .65); }
  }, 256, 256, [3, 3], true);
  const plaster = makeTexture((g, w, h) => {
    g.fillStyle = '#f1ede4'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 8500, .035, 1);
  }, 256, 256, [3, 1]);

  const paving = makeTexture((g, w, h) => {
    g.fillStyle = '#a69f92'; g.fillRect(0, 0, w, h);
    const tileW = 64, tileH = 32;
    for (let y = 0, row = 0; y < h; y += tileH, row++) {
      const offset = row % 2 ? tileW / 2 : 0;
      for (let x = -offset; x < w; x += tileW) {
        g.fillStyle = shade('#c7c0b2', (random() - .5) * 16); g.fillRect(x + 1, y + 1, tileW - 2, tileH - 2);
        g.fillStyle = 'rgba(255,255,255,.19)'; g.fillRect(x + 1, y + 1, tileW - 2, .7);
        g.fillStyle = 'rgba(73,65,49,.08)'; g.fillRect(x + 1, y + tileH - 2, tileW - 2, .7);
      }
    }
    speckle(g, w, h, 14000, .055, 1.1);
  }, 512, 512, [28, 3.2]);
  const asphalt = makeTexture((g, w, h) => {
    g.fillStyle = '#363b3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 23000; i++) {
      const v = 42 + random() * 48;
      g.fillStyle = `rgba(${v},${v + 2},${v + 3},.42)`;
      g.fillRect(random() * w, random() * h, .6 + random(), .6 + random());
    }
  }, 256, 256, [140, 1]);

  const floors = { wood: woodMap, oak: oakMap, concrete: concreteMap, carpet: carpetMap, marble: marbleMap };
  const floorMaterials = Object.fromEntries(Object.entries(floors).map(([key, map]) => {
    const timber = key === 'wood' || key === 'oak';
    return [key, makeMaterial({ color: '#ffffff', map, roughness: key === 'marble' ? .3 : timber ? .48 : .87,
      bumpMap: timber ? woodRelief : mineralRelief, bumpScale: key === 'marble' ? .012 : timber ? .018 : .03, metalness: 0 })];
  }));
  const materials = {
    plaster: makeMaterial({ color: '#ffffff', map: plaster, bumpMap: mineralRelief, bumpScale: .014, roughness: .88 }),
    paving: makeMaterial({ color: '#ffffff', map: paving, bumpMap: mineralRelief, bumpScale: .035, roughness: .84 }),
    asphalt: makeMaterial({ color: '#ffffff', map: asphalt, roughness: .94 }),
    stone: makeMaterial({ color: '#d5cfc2', bumpMap: mineralRelief, bumpScale: .025, roughness: .64 }),
    frame: makeMaterial({ color: '#262c2e', roughness: .31, metalness: .72 }),
    champagne: makeMaterial({ color: '#c6ae7d', roughness: .27, metalness: .65 }),
    desk: makeMaterial({ color: '#f0e6d6', roughness: .45, metalness: 0 }),
    fabric: makeMaterial({ color: '#242c30', roughness: .91, bumpMap: mineralRelief, bumpScale: .012 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#d6e7e5', transparent: true, opacity: .13,
      roughness: .08, metalness: .06, clearcoat: .8, clearcoatRoughness: .08, depthWrite: false }),
  };
  materialSet.add(materials.glass);
  return { floors, floorMaterials, paving, asphalt, plaster, materials,
    dispose() { materialSet.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()); } };
}

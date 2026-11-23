// A stand-in for the page's command layer, built on the real engine (Core.evalDoc), for Node tests.
// Blocks are kept in reading order; "after" places a block right below another, like the page does.
module.exports = function fakeDoc(Core, regions = []) {
  let seq = 0, results = new Map(); const images = {};
  const doc = {
    images,
    regions: () => regions,
    region: id => regions.find(r => r.id === id),
    results: () => results,
    evaluate() { results = Core.evalDoc(regions).results; return results; },
    add(spec, afterId) {
      const rg = { id: 'b' + (++seq), x: 26, y: 0, ...spec };
      const i = afterId ? regions.findIndex(r => r.id === afterId) : -1;
      if (i >= 0) regions.splice(i + 1, 0, rg); else regions.push(rg);
      relayout(); return rg;
    },
    edit(id, patch) { const rg = doc.region(id); Object.assign(rg, patch); if (patch.kind === undefined) delete rg.kind; return rg; },
    move(id, afterId) {
      const i = regions.findIndex(r => r.id === id), [rg] = regions.splice(i, 1);
      const j = afterId ? regions.findIndex(r => r.id === afterId) : -1;
      regions.splice(j + 1, 0, rg); relayout(); return rg;
    },
    positions() { const p = {}; for (const r of regions) p[r.id] = { x: r.x, y: r.y }; return p; },
    setPositions(map) { for (const r of regions) if (map[r.id]) { r.x = map[r.id].x; r.y = map[r.id].y; } regions.sort((a, b) => a.y - b.y || a.x - b.x); relayout(); },
    remove(id) { const i = regions.findIndex(r => r.id === id); if (i < 0) return null; const [rg] = regions.splice(i, 1); return JSON.parse(JSON.stringify(rg)); },
    restore(copy) { regions.push(copy); regions.sort((a, b) => a.y - b.y || a.x - b.x); relayout(); },
    addImage(src) { const k = 'i' + (++seq); images[k] = src; return k; },
  };
  // y positions follow list order, so setPositions/restore can put a block back in its old slot
  function relayout() { regions.forEach((r, i) => { r.y = i * 10; }); }
  relayout();
  return doc;
};

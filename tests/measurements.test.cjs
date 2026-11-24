const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function app(storage = new Map()) {
  const context = vm.createContext({ window: {}, localStorage: {
    setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k)
  }});
  for (const file of ['geometry', 'symbols', 'state', 'export']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
  }
  return context.window.FP;
}
const plain = value => JSON.parse(JSON.stringify(value));
test('metric input rejects partial, invalid, nonpositive, below-minimum and overflowing lengths', () => {
  const G = app().geom;
  for (const value of ['', ' ', '-', '.', '1e', '12junk', '1 m', '0x10', 'Infinity', 'NaN', '-1', '0', '0.019', '1e309', '1e307']) {
    assert.equal(G.parseMeters(value, 0.02), null, value);
  }
  for (const [value, expected] of [['0.02', .02], ['.125', .125], ['1.2345', 1.2345], ['2e-1', .2]]) {
    assert.equal(G.parseMeters(value, .02), expected);
  }
});
test('calibration scales both icon types about a pivot and preserves metadata, export mappings, persistence and undo', () => {
  const FP = app();
  FP.model.icons = [
    { id:'e1', x:30, y:50, w:40, h:60, href:'data:image/png;base64,AA==', entity:'switch.tv', tap:'homeassistant.toggle', stateColor:true },
    { id:'e2', x:30, y:50, w:40, h:60, mdi:'television', pathData:'M0 0h24v24H0z', entity:'switch.pc', tap:'more-info' }
  ];
  FP.model.walls = [{id:'e3', points:[{x:10,y:20},{x:110,y:20}], thickness:12}];
  FP.model.uid = 4;
  const before = FP.snapshot();
  const yaml = FP.buildYAML(FP.model);
  FP.beginChange(); FP.scaleModel(2, {x:10,y:20}); FP.commitChange();
  for (const icon of FP.model.icons) {
    assert.deepEqual([icon.x, icon.y, icon.w, icon.h], [50,80,80,120]);
    const original = JSON.parse(before).icons.find(o => o.id === icon.id);
    assert.deepEqual(plain({...icon, x:original.x,y:original.y,w:original.w,h:original.h}), original);
  }
  assert.deepEqual(plain(FP.model.walls[0].points), [{x:10,y:20},{x:210,y:20}]);
  assert.equal(FP.model.walls[0].thickness, 24);
  assert.equal(FP.buildYAML(FP.model), yaml);
  const svg = FP.buildExportSVG(FP.model);
  assert.ok(svg.includes('switch.tv') && svg.includes('switch.pc'));
  for (const icon of FP.model.icons) assert.ok(svg.includes(FP.sym.icon(icon)));
  const scaled = FP.snapshot();
  FP.undo(); assert.equal(FP.snapshot(), before);
  FP.redo(); assert.equal(FP.snapshot(), scaled);
  assert.equal(FP.load(), true); assert.equal(FP.snapshot(), scaled);
  FP.scaleModel(1, {x:10,y:20}); assert.equal(FP.snapshot(), scaled);
  for (const factor of [0,-1,Infinity,NaN]) { FP.scaleModel(factor,{x:10,y:20}); assert.equal(FP.snapshot(),scaled); }
  FP.scaleModel(.5, {x:10,y:20}); assert.equal(FP.snapshot(), before);
  FP.model.icons = []; assert.doesNotThrow(() => FP.scaleModel(2,{x:0,y:0}));
});

// Exercise private UI wiring in a VM with minimal event/validity stubs.
// This checks handlers, not browser-native input presentation or sanitization.
function ui() {
  const FP = app();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', min: '0', dataset: {}, handlers: {}, attrs: {}, hidden: false,
      focus() {}, select() {},
      querySelectorAll() { return []; },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      setCustomValidity(message) { this.error = message; },
      setAttribute(k,v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      reportValidity() { this.reported = true; },
      classList: { add() { element(id).hidden = true; }, remove() { element(id).hidden = false; } }
    });
    return elements.get(id);
  };
  FP.editor = { render() {}, applyScale() { return true; } };
  const context = vm.createContext({window:{FP}, document:{
    addEventListener() {}, getElementById:element
  }});
  const source = fs.readFileSync(path.join(__dirname,'../js/main.js'),'utf8');
  vm.runInContext(source.replace('})(window.FP = window.FP || {});',
    'FP.testUI = {wireInspector, applyScale, wireScaleDialog, lengthInput, INSPECTORS}; })(window.FP = window.FP || {});'), context);
  return {FP, element};
}
test('all physical inspector handlers preserve geometry for bad input and recover with precise valid values', () => {
  for (const [type, id, key, min] of [
    ['walls','i-th','thickness',.02], ['doors','i-w','width',.3],
    ['windows','i-w','width',.3], ['fans','i-r','r',.05],
    ['icons','i-w','w',.1], ['icons','i-h','h',.1]
  ]) {
    const {FP,element} = ui();
    const object = {[key]:42};
    FP.testUI.wireInspector({type},object);
    const input = element(id); input.min = String(min);
    for (const bad of ['', '-', '-1', '0', String(min/2), 'Infinity', '12junk']) {
      input.value = bad; input.handlers.input({target:input});
      assert.equal(object[key],42, type + ':' + bad);
      assert.equal(input.attrs['aria-invalid'],'true');
    }
    input.handlers.change({target:input}); assert.equal(input.reported,true);
    input.value = '1.2345'; input.handlers.input({target:input});
    assert.ok(Math.abs(object[key] - 123.45) < 1e-10);
    assert.equal(input.error,''); assert.equal(input.attrs['aria-invalid'],undefined);
  }
});
test('calibration dialog retains invalid entry for correction and applies valid metres once', () => {
  const {FP,element} = ui();
  const input = element('scale-value'); input.min = '.01';
  const applied = []; FP.editor.applyScale = value => { applied.push(value); return true; };
  input.value = '-1'; FP.testUI.applyScale();
  assert.equal(element('scale-modal').hidden,false); assert.deepEqual(applied,[]);
  assert.equal(input.reported,true);
  input.value = '2.5'; FP.testUI.applyScale();
  assert.deepEqual(applied,[2.5]); assert.equal(element('scale-modal').hidden,true);
});

test('editor calibration rejects invalid factors without losing the measurement and supports a corrected value', () => {
  const FP = app();
  FP.model.icons = [{id:'e1', x:30,y:50,w:40,h:60}]; FP.model.uid = 2;
  const context = vm.createContext({window:{FP}});
  const source = fs.readFileSync(path.join(__dirname,'../js/editor.js'),'utf8');
  vm.runInContext(source.replace('  FP.editor = Ed;',
    '  lastMeasure = { a: {x:10,y:20}, worldLen:100 }; FP.editor = Ed;'), context);
  FP.editor.render = () => {}; FP.editor.zoomFit = () => {};
  const before = FP.snapshot();
  for (const value of [NaN, Infinity, -1, 0, 1e308]) {
    assert.equal(FP.editor.applyScale(value), false);
    assert.equal(FP.snapshot(), before);
  }
  assert.equal(FP.editor.applyScale(2), true);
  assert.deepEqual(plain(FP.model.icons[0]), {id:'e1',x:50,y:80,w:80,h:120});
  FP.undo(); assert.equal(FP.snapshot(), before);
  FP.redo(); assert.equal(FP.model.icons[0].w,80);
});

test('imperial conversion, strict numeric parsing and dimension rounding', () => {
  const FP = app(), G = FP.geom;
  for (const [value,unit,px] of [['12','in',30.48],['1','ft',30.48],['36','in',91.44],['1','m',100]]) {
    assert.ok(Math.abs(G.toPx(G.parseLength(value,unit)) - px) < 1e-10);
    assert.ok(Math.abs(G.fromWorld(px,unit) - Number(value)) < 1e-10);
  }
  FP.setUnitSystem('imperial');
  assert.equal(G.fmtLength(30.48),'1 ft 0 in');
  assert.equal(G.fmtLength(91.44),'3 ft 0 in');
  assert.equal(G.fmtLength(2.54*11.999),'1 ft 0 in');
  assert.equal(G.fmtLength(2.54*102.5),'8 ft 6.5 in');
  for (const value of ['', '-', '1/2', '2 ft', '2junk', 'Infinity','0','-1']) assert.equal(G.parseLength(value,'in'),null);
  assert.equal(G.parseLength('1','in',.3),null);
  FP.setUnitSystem('metric'); assert.equal(G.fmtLength(100),'1.00 m');
});
test('unit preference survives reload and never changes project data or geometry', () => {
  const storage = new Map(); const FP = app(storage);
  FP.model.walls = [{id:'e1',points:[{x:0,y:0},{x:100,y:100}],thickness:12}]; FP.model.uid=2;
  const snapshot=FP.snapshot();
  for(let i=0;i<50;i++) {
    FP.setUnitSystem('imperial'); assert.equal(FP.state.grid,2.54);
    FP.setUnitSystem('metric'); assert.equal(FP.state.grid,10);
  }
  assert.equal(FP.snapshot(),snapshot);
  FP.persist(); FP.setUnitSystem('imperial'); FP.savePrefs();
  const fresh=app(storage); fresh.load(); fresh.loadPrefs();
  assert.equal(fresh.snapshot(),snapshot); assert.equal(fresh.state.unitSystem,'imperial'); assert.equal(fresh.state.grid,2.54);
  for(const prefs of [{},{unitSystem:'invalid'}]) {
    storage.set('floorplanner_ha_prefs_v1',JSON.stringify(prefs)); fresh.loadPrefs();
    assert.equal(fresh.state.unitSystem,'metric'); assert.equal(fresh.state.grid,10);
  }
});
test('imperial changes only SVG dimension text, preserving CSS, YAML and model', () => {
  const FP=app();
  FP.model.walls=[{id:'e1',points:[{x:0,y:0},{x:91.44,y:30.48}],thickness:12}];
  const snapshot=FP.snapshot(), metric=FP.buildExportSVG(FP.model), css=FP.buildCSS(FP.model), yaml=FP.buildYAML(FP.model);
  FP.setUnitSystem('imperial'); const imperial=FP.buildExportSVG(FP.model);
  assert.ok(imperial.includes('3 ft 0 in') && imperial.includes('1 ft 0 in'));
  const strip=s=>s.replace(/(<text class="fp-dim-text"[^>]*>)[^<]*(<\/text>)/g,'$1$2');
  assert.equal(strip(imperial),strip(metric)); assert.equal(FP.snapshot(),snapshot);
  assert.equal(FP.buildCSS(FP.model),css); assert.equal(FP.buildYAML(FP.model),yaml);
  FP.setUnitSystem('metric'); assert.equal(FP.buildExportSVG(FP.model),metric);
});
test('every imperial inspector field renders inches and converts valid edits while preserving bad-input behavior', () => {
  for (const [type,id,key,min] of [['walls','i-th','thickness',.02],['doors','i-w','width',.3],['windows','i-w','width',.3],['fans','i-r','r',.05],['icons','i-w','w',.1],['icons','i-h','h',.1]]) {
    const {FP,element}=ui(); FP.setUnitSystem('imperial');
    const object={[key]:91.44}; const markup=FP.testUI.lengthInput(id,object[key],min,.05);
    assert.ok(markup.includes('data-unit="in"')); assert.ok(markup.includes('value="36"'));
    FP.testUI.wireInspector({type},object);
    const input=element(id); input.dataset={unit:'in',minMeters:String(min)};
    input.value='-1'; input.handlers.input({target:input}); assert.equal(object[key],91.44);
    input.value='48.125'; input.handlers.input({target:input}); assert.ok(Math.abs(object[key]-122.2375)<1e-9);
    assert.equal(input.error,'');
  }
});
test('imperial calibration opens in feet, switches to inches and passes metres to the editor', () => {
  const {FP,element}=ui(); FP.setUnitSystem('imperial'); FP.testUI.wireScaleDialog();
  FP.onScaleMeasured(.9144);
  const input=element('scale-value'), unit=element('scale-unit');
  assert.equal(input.dataset.unit,'ft'); assert.equal(Number(input.value),3);
  assert.equal(element('scale-current').textContent,'3 ft 0 in');
  unit.value='in'; unit.handlers.change({target:unit});
  assert.equal(Number(input.value),36); assert.equal(input.dataset.unit,'in');
  let metres; FP.editor.applyScale=value=>{metres=value;return true;};
  FP.testUI.applyScale(); assert.ok(Math.abs(metres-.9144)<1e-12);
});

test('grid rendering and snap points follow imperial spacing without mutating geometry', () => {
  const FP=app(), grid={innerHTML:''};
  const context=vm.createContext({window:{FP}, document:{documentElement:{getAttribute:()=> 'light'}}});
  const source=fs.readFileSync(path.join(__dirname,'../js/editor.js'),'utf8');
  context.testGrid=grid;
  vm.runInContext(source.replace('  FP.editor = Ed;',
    '  stage={getBoundingClientRect:()=>({width:200,height:200})}; gridG=testGrid; Ed.testGrid=renderGrid; Ed.testSnap=snapWorld; FP.editor=Ed;'),context);
  FP.state.view={tx:0,ty:0,zoom:1}; const before=FP.snapshot();
  FP.setUnitSystem('imperial'); FP.editor.testGrid();
  assert.ok(grid.innerHTML.includes('x1="30.48"'));
  const point=FP.editor.testSnap({x:7,y:10},{noVertex:true});
  assert.ok(Math.abs(point.x-7.62)<1e-10 && Math.abs(point.y-10.16)<1e-10);
  FP.setUnitSystem('metric'); FP.editor.testGrid(); assert.ok(grid.innerHTML.includes('x1="100"'));
  assert.equal(FP.snapshot(),before);
});

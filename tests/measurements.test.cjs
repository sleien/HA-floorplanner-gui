const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function app() {
  const storage = new Map();
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
      value: '', min: '0', handlers: {}, attrs: {}, hidden: false,
      querySelectorAll() { return []; },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      setCustomValidity(message) { this.error = message; },
      setAttribute(k,v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
      reportValidity() { this.reported = true; },
      classList: { add() { element(id).hidden = true; } }
    });
    return elements.get(id);
  };
  FP.editor = { render() {}, applyScale() { return true; } };
  const context = vm.createContext({window:{FP}, document:{
    addEventListener() {}, getElementById:element
  }});
  const source = fs.readFileSync(path.join(__dirname,'../js/main.js'),'utf8');
  vm.runInContext(source.replace('})(window.FP = window.FP || {});',
    'FP.testUI = {wireInspector, applyScale}; })(window.FP = window.FP || {});'), context);
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

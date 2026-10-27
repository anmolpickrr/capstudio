// A stand-in for the parts of After Effects' scripting DOM that the Capstudio
// script (static/ae/capstudio-ae.jsx) and the panel's host script (panel/host/host.jsx)
// use, for tests. A plain script: it defines makeFakeAE(installedFonts, scene) on the
// global object. scene (optional): an open composition { name, width, height, fps,
// duration, projectPath, layers: [{ name, path, startTime, inPoint, outPoint, stretch,
// selected, timeRemap, hasAudio, enabled, audioEnabled }] }, top layer first.
(function (root) {
  function makeFakeAE(installed, scene) {
    var alerts = [], comps = [], imported = [];
    function Prop(name) { this.name = name; this.children = {}; this.added = []; this.keys = []; this._value = undefined; }
    Prop.prototype.property = function (n) { return this.children[n] || (this.children[n] = new Prop(n)); };
    Prop.prototype.addProperty = function (n) { var p = new Prop(n); this.added.push(p); return p; };
    Prop.prototype.setValue = function (v) {
      if (this.keys.length) throw new Error('Property ' + this.name + ' has keyframes; setValue is not allowed');
      this._value = v;
    };
    Prop.prototype.setValuesAtTimes = function (ts, vs) {
      if (ts.length !== vs.length) throw new Error('times and values differ in length');
      for (var i = 0; i < ts.length; i++) this.keys.push([ts[i], vs[i]]);
    };
    Prop.prototype.setValueAtTime = function (t, v) { this.keys.push([t, v]); };
    Object.defineProperty(Prop.prototype, 'value', { get: function () { return this._value && this._value.clone ? this._value.clone() : this._value; } });

    function TextDocument(text) { this.text = text; this._font = 'ArialMT'; this.fontSize = 36; }
    Object.defineProperty(TextDocument.prototype, 'font', {
      get: function () { return this._font; },
      set: function (f) { if (installed.indexOf(f) >= 0) this._font = f; },
    });
    TextDocument.prototype.clone = function () {
      var d = new TextDocument(this.text), k;
      for (k in this) if (Object.prototype.hasOwnProperty.call(this, k)) d[k] = this[k];
      return d;
    };

    function Layer(kind, text) {
      this.kind = kind; this.text = text; this.root = new Prop('root'); this.startTime = 0; this.inPoint = 0; this.outPoint = 0; this.name = '';
      this.stretch = 100; this.timeRemapEnabled = false; this.selected = false;
      if (kind === 'text') this.root.property('ADBE Text Properties').property('ADBE Text Document')._value = new TextDocument(text);
    }
    Layer.prototype.property = function (n) { return this.root.property(n); };
    Layer.prototype.moveBefore = function (other) {
      var list = this.comp.list;
      list.splice(list.indexOf(this), 1);
      list.splice(list.indexOf(other), 0, this);
    };
    Object.defineProperty(Layer.prototype, 'index', { get: function () { return this.comp.list.indexOf(this) + 1; } });

    function FootageItem(path) {
      this.name = String(path).split('/').pop(); this.width = 1080; this.height = 1920;
      this.mainSource = { file: { fsName: path } }; this.file = this.mainSource.file;
    }
    function CompItem(name, w, h, par, dur, fps) {
      var self = this;
      this.name = name; this.width = w; this.height = h; this.duration = dur; this.frameRate = fps; this.list = []; this.opened = false;
      function add(l) { l.comp = self; self.list.unshift(l); return l; }
      this.layers = {
        addText: function (t) { return add(new Layer('text', t)); },
        addShape: function () { return add(new Layer('shape')); },
        add: function (item) { var l = new Layer(item instanceof CompItem ? 'precomp' : 'footage'); l.source = item; l.name = item.name; return add(l); },
      };
    }
    CompItem.prototype.openInViewer = function () { this.opened = true; };
    CompItem.prototype.layer = function (i) { return this.list[i - 1]; };
    Object.defineProperty(CompItem.prototype, 'numLayers', { get: function () { return this.list.length; } });
    Object.defineProperty(CompItem.prototype, 'selectedLayers', { get: function () { return this.list.filter(function (l) { return l.selected; }); } });
    var Comp = CompItem;

    var active = null;
    if (scene) {
      active = new CompItem(scene.name || 'Reel', scene.width, scene.height, 1, scene.duration || 30, scene.fps);
      for (var i = scene.layers.length - 1; i >= 0; i--) {
        var d = scene.layers[i];
        var l = d.path ? active.layers.add(new FootageItem(d.path)) : active.layers.addShape();
        l.name = d.name; l.startTime = d.startTime || 0; l.inPoint = d.inPoint || 0; l.outPoint = d.outPoint || 0;
        l.stretch = d.stretch || 100; l.selected = !!d.selected; l.timeRemapEnabled = !!d.timeRemap;
        l.hasVideo = !!d.path; l.hasAudio = !!d.path && d.hasAudio !== false; l.enabled = d.enabled !== false; l.audioEnabled = d.audioEnabled !== false;
      }
    }

    var undo = 0;
    var g = {
      app: {
        beginUndoGroup: function () { undo++; }, endUndoGroup: function () { undo--; },
        project: {
          activeItem: active, file: scene && scene.projectPath ? { fsName: scene.projectPath } : null,
          items: { addComp: function (n, w, h, p, d, f) { var c = new Comp(n, w, h, p, d, f); comps.push(c); return c; } },
          importFile: function (opts) { imported.push(opts.file.fsName); return new FootageItem(opts.file.fsName); },
        },
      },
      $: { fileName: '/work/export/script.jsx' },
      File: function (path) {
        var p = String(path);
        return { fsName: p, exists: true, parent: { fsName: p.replace(/\/[^/]*$/, '') } };
      },
      ImportOptions: function (file) { this.file = file; },
      CompItem: CompItem, FootageItem: FootageItem,
      Shape: function () { this.vertices = []; this.closed = false; },
      ParagraphJustification: { CENTER_JUSTIFY: 'center' },
      LineJoinType: { LINE_JOIN_ROUND: 'round' },
      alert: function (m) { alerts.push(String(m)); },
    };
    return { globals: g, comps: comps, alerts: alerts, imported: imported, active: active, undoDepth: function () { return undo; } };
  }
  root.makeFakeAE = makeFakeAE;
}(this));

// A stand-in for the parts of After Effects' scripting DOM that the Capstudio
// script (static/ae/capstudio-ae.jsx) uses, for tests. A plain script: it defines
// makeFakeAE(installedFonts) on the global object.
(function (root) {
  function makeFakeAE(installed) {
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
      if (kind === 'text') this.root.property('ADBE Text Properties').property('ADBE Text Document')._value = new TextDocument(text);
    }
    Layer.prototype.property = function (n) { return this.root.property(n); };

    function Comp(name, w, h, par, dur, fps) {
      var self = this;
      this.name = name; this.width = w; this.height = h; this.duration = dur; this.frameRate = fps; this.list = []; this.opened = false;
      this.layers = {
        addText: function (t) { var l = new Layer('text', t); self.list.unshift(l); return l; },
        addShape: function () { var l = new Layer('shape'); self.list.unshift(l); return l; },
        add: function (item) { var l = new Layer('footage'); l.source = item; self.list.unshift(l); return l; },
      };
    }
    Comp.prototype.openInViewer = function () { this.opened = true; };

    var undo = 0;
    var g = {
      app: {
        beginUndoGroup: function () { undo++; }, endUndoGroup: function () { undo--; },
        project: {
          items: { addComp: function (n, w, h, p, d, f) { var c = new Comp(n, w, h, p, d, f); comps.push(c); return c; } },
          importFile: function (opts) { imported.push(opts.file.fsName); return { width: 1080, height: 1920, file: opts.file }; },
        },
      },
      $: { fileName: '/work/export/script.jsx' },
      File: function (path) {
        var p = String(path);
        return { fsName: p, exists: true, parent: { fsName: p.replace(/\/[^/]*$/, '') } };
      },
      ImportOptions: function (file) { this.file = file; },
      Shape: function () { this.vertices = []; this.closed = false; },
      ParagraphJustification: { CENTER_JUSTIFY: 'center' },
      LineJoinType: { LINE_JOIN_ROUND: 'round' },
      alert: function (m) { alerts.push(String(m)); },
    };
    return { globals: g, comps: comps, alerts: alerts, imported: imported, undoDepth: function () { return undo; } };
  }
  root.makeFakeAE = makeFakeAE;
}(this));

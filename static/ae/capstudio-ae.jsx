/* Capstudio captions for After Effects (ExtendScript, ES3).
 * Run it from File > Scripts > Run Script File. It builds a composition the size,
 * frame rate and length of your video with every caption as editable layers: a
 * text layer per word (plus its shadow and glow), shape layers for backgrounds and
 * pills, all animated with keyframes. Drop the composition over your footage at 0:00.
 * Install the fonts in the "fonts" folder next to this script first.
 *
 * CapstudioBuild(D, comp) does the building; the Capstudio panel for After Effects
 * loads this file (with no captions filled in) to use it on its own precomp. */
function CapstudioBuild(D, comp) {

  function rgb(hex) {
    var h = String(hex || '#000000').replace('#', '');
    return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
  }

  // Keyframes from [[time, ...values], ...]; one key means a fixed value.
  function keys(prop, list, value) {
    var i, times = [], values = [];
    if (!list || !list.length) return;
    if (list.length === 1) { prop.setValue(value(list[0])); return; }
    for (i = 0; i < list.length; i++) { times.push(list[i][0]); values.push(value(list[i])); }
    prop.setValuesAtTimes(times, values);
  }

  function hasMotion(list, from) {
    var i;
    for (i = 0; list && i < list.length; i++) if (list[i][1] > (from || 0)) return true;
    return false;
  }

  function transform(layer, k, anchor) {
    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue(anchor);
    keys(tr.property('ADBE Position'), k.position, function (v) { return [v[1], v[2]]; });
    keys(tr.property('ADBE Scale'), k.scale, function (v) { return [v[1], v[1]]; });
    keys(tr.property('ADBE Rotate Z'), k.rotation, function (v) { return v[1]; });
    keys(tr.property('ADBE Opacity'), k.opacity, function (v) { return v[1]; });
    if (hasMotion(k.blur, 0.05)) {
      var fx = layer.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2');
      keys(fx.property('ADBE Gaussian Blur 2-0001'), k.blur, function (v) { return v[1]; });
    }
  }

  function timing(layer, d) {
    layer.startTime = 0;
    layer.inPoint = d['in'];
    layer.outPoint = d.out;
    layer.name = d.name;
  }

  var missing = {}, missingCount = 0;

  function styled(doc, s) {
    doc.applyFill = !!s[1];
    if (s[1]) doc.fillColor = rgb(s[1]);
    doc.applyStroke = s[2] > 0;
    if (s[2] > 0) doc.strokeWidth = s[2];
    return doc;
  }

  function textLayer(comp, d) {
    var layer = comp.layers.addText(d.text), i;
    var source = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var doc = source.value;
    doc.fontSize = d.size;
    try { doc.font = d.font; } catch (e) { /* not installed: reported below */ }
    doc.tracking = d.tracking;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    doc.strokeColor = rgb(d.stroke);
    doc.strokeOverFill = false;
    try { doc.lineJoinType = LineJoinType.LINE_JOIN_ROUND; } catch (e2) { /* older After Effects */ }
    source.setValue(styled(doc, d.style[0]));
    if (source.value.font !== d.font && !missing[d.font]) { missing[d.font] = d.fontName; missingCount++; }
    for (i = 1; i < d.style.length; i++) {
      doc = source.value;
      source.setValueAtTime(d.style[i][0], styled(doc, d.style[i]));
    }
    if (d.keys.mask) {
      var mask = layer.property('ADBE Mask Parade').addProperty('ADBE Mask Atom');
      keys(mask.property('ADBE Mask Shape'), d.keys.mask, function (v) {
        var s = new Shape();
        s.vertices = [[v[1], v[2]], [v[1] + v[3], v[2]], [v[1] + v[3], v[2] + v[4]], [v[1], v[2] + v[4]]];
        s.closed = true;
        return s;
      });
    }
    transform(layer, d.keys, [0, d.desc]);
    timing(layer, d);
  }

  function boxLayer(comp, d) {
    var layer = comp.layers.addShape();
    var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var shapes = group.property('ADBE Vectors Group');
    var rect = shapes.addProperty('ADBE Vector Shape - Rect');
    keys(rect.property('ADBE Vector Rect Size'), d.keys.size, function (v) { return [v[1], v[2]]; });
    keys(rect.property('ADBE Vector Rect Position'), d.keys.size, function (v) { return [v[1] / 2, v[2] / 2]; });
    keys(rect.property('ADBE Vector Rect Roundness'), d.keys.radius, function (v) { return v[1]; });
    shapes.addProperty('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue(rgb(d.color));
    transform(layer, d.keys, [0, 0]);
    timing(layer, d);
  }

  function watermark(comp, w) {
    var file = new File(w.path || File($.fileName).parent.fsName + '/' + w.file), item, layer, tr;
    if (!file.exists) return;
    item = app.project.importFile(new ImportOptions(file));
    layer = comp.layers.add(item);
    tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Position').setValue([w.x + w.w / 2, w.y + w.h / 2]);
    tr.property('ADBE Scale').setValue([w.w / item.width * 100, w.h / item.height * 100]);
    tr.property('ADBE Opacity').setValue(w.opacity * 100);
    layer.name = 'Watermark';
  }

  var i, names = [];
  if (D.watermark) watermark(comp, D.watermark);
  // layers are added on top, so in drawing order the last drawn ends up in front
  for (i = 0; i < D.layers.length; i++) {
    if (D.layers[i].type === 'box') boxLayer(comp, D.layers[i]); else textLayer(comp, D.layers[i]);
  }
  for (i in missing) if (missing.hasOwnProperty(i)) names.push(missing[i]);
  return { count: D.layers.length, missing: names };
}

(function (D) {
  if (D === false) return; // loaded by the panel, which calls CapstudioBuild itself
  if (!D) { alert('This script has no captions in it. Export it again from Capstudio.'); return; }
  app.beginUndoGroup('Capstudio captions');
  var comp = app.project.items.addComp(D.name, D.width, D.height, 1, D.duration, D.fps);
  var result = CapstudioBuild(D, comp);
  comp.openInViewer();
  app.endUndoGroup();
  alert('Capstudio: ' + result.count + ' layers in "' + D.name + '". Place it over your footage at 0:00.' +
    (result.missing.length ? '\n\nThese fonts aren\'t installed, so After Effects used a stand-in: ' + result.missing.join(', ') +
      '. Install them from the "fonts" folder next to this script, restart After Effects and run the script again.' : ''));
}(/*CAPSTUDIO_DATA*/null));

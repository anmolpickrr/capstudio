/* Capstudio: the Premiere Pro and After Effects side of the panel (ExtendScript, ES3).
 * Premiere Pro: Capstudio.selection() says which clip to caption, Capstudio.place()
 * puts the finished captions on the timeline. After Effects: CapstudioAE.selection()
 * says which layer, CapstudioAE.build() adds the captions as editable layers in a
 * precomp (with CapstudioBuild from static/ae/capstudio-ae.jsx, which the panel loads
 * first), CapstudioAE.placeFootage() adds a transparent captions video instead.
 * Every function returns a JSON string: {"ok": true, ...} or {"ok": false, "error": "..."}. */
var Capstudio = (function () {
  var TICKS_PER_SECOND = 254016000000;

  function quote(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  }

  // ExtendScript has no JSON object, so answers are written by hand.
  function json(v) {
    var i, parts;
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return quote(v);
    if (v instanceof Array) {
      parts = [];
      for (i = 0; i < v.length; i++) parts.push(json(v[i]));
      return '[' + parts.join(',') + ']';
    }
    parts = [];
    for (i in v) if (v.hasOwnProperty(i)) parts.push(quote(i) + ':' + json(v[i]));
    return '{' + parts.join(',') + '}';
  }

  function fail(message) { return json({ ok: false, error: message }); }

  function frameRate(seq) {
    var tb = Number(seq.timebase);
    return tb > 0 ? TICKS_PER_SECOND / tb : 30;
  }

  // The video track a selected clip sits on (0 = V1), or -1.
  function trackOf(seq, clip) {
    var t, c, track;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
      track = seq.videoTracks[t];
      for (c = 0; c < track.clips.numItems; c++) {
        if (track.clips[c].isSelected() && track.clips[c].name === clip.name &&
            Math.abs(track.clips[c].start.seconds - clip.start.seconds) < 0.001) return t;
      }
    }
    return -1;
  }

  // The selected clip in the active sequence: its media file, where it sits in the
  // timeline, and the sequence's frame size and rate.
  function selection() {
    var seq = app.project.activeSequence, sel, pick = null, i, path, speed = 1;
    if (!seq) return fail('Open a sequence first.');
    sel = seq.getSelection();
    for (i = 0; i < sel.length; i++) {
      if (sel[i].projectItem && sel[i].mediaType === 'Video') { pick = sel[i]; break; }
    }
    if (!pick) {
      for (i = 0; i < sel.length; i++) if (sel[i].projectItem) { pick = sel[i]; break; }
    }
    if (!pick) return fail('Select the clip to caption in the timeline first.');
    path = pick.projectItem.getMediaPath();
    if (!path) return fail('That clip has no media file (a title, graphic or nested sequence). Select a video clip.');
    try { speed = pick.getSpeed(); } catch (e) { speed = 1; }
    if (!(speed > 0)) return fail('Reversed clips can\'t be captioned. Select a clip that plays forwards.');
    return json({
      ok: true,
      project: app.project.path,
      sequence: { name: seq.name, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: frameRate(seq) },
      clip: {
        name: pick.name, path: path, start: pick.start.seconds, end: pick.end.seconds,
        inPoint: pick.inPoint.seconds, speed: speed, track: pick.mediaType === 'Video' ? trackOf(seq, pick) : -1
      }
    });
  }

  function norm(p) { return String(p || '').replace(/\\/g, '/').toLowerCase(); }

  function bin(name) {
    var root = app.project.rootItem, i, c;
    for (i = 0; i < root.children.numItems; i++) {
      c = root.children[i];
      if (c.name === name && c.type === ProjectItemType.BIN) return c;
    }
    return root.createBin(name);
  }

  function importInto(folder, path) {
    var i, c;
    if (!app.project.importFiles([path], true, folder, false)) return null;
    for (i = folder.children.numItems - 1; i >= 0; i--) {
      c = folder.children[i];
      if (c.type !== ProjectItemType.BIN && norm(c.getMediaPath()) === norm(path)) return c;
    }
    return null;
  }

  function isFree(track, start, end) {
    var i, c;
    for (i = 0; i < track.clips.numItems; i++) {
      c = track.clips[i];
      if (c.start.seconds < end - 0.001 && c.end.seconds > start + 0.001) return false;
    }
    return true;
  }

  // Import the captions video into a "Capstudio" bin and put it on the first video
  // track above the clip that's empty for the clip's span; optionally add the SRT
  // as an editable caption track starting at the same time.
  function place(movPath, srtPath, start, end, above) {
    var seq = app.project.activeSequence, folder, item, t, track = -1, captions = false, srt;
    if (!seq) return fail('Open the sequence first.');
    folder = bin('Capstudio');
    item = importInto(folder, movPath);
    if (!item) return fail('Premiere couldn\'t import the captions file.');
    for (t = Math.max(0, above + 1); t < seq.videoTracks.numTracks; t++) {
      if (isFree(seq.videoTracks[t], start, end)) { track = t; break; }
    }
    if (track < 0) return fail('There\'s no empty video track above the clip. Add one (Sequence > Add Tracks), then try again. The captions file is in the Capstudio bin.');
    seq.videoTracks[track].overwriteClip(item, start);
    if (srtPath) {
      srt = importInto(folder, srtPath);
      if (srt && seq.createCaptionTrack) {
        captions = !!seq.createCaptionTrack(srt, start,
          typeof Sequence !== 'undefined' && Sequence.CAPTION_FORMAT_SUBTITLE ? Sequence.CAPTION_FORMAT_SUBTITLE : undefined);
      }
    }
    return json({ ok: true, track: track + 1, captions: captions });
  }

  return { selection: selection, place: place, json: json };
}());

var CapstudioAE = (function () {
  var json = Capstudio.json;
  function fail(message) { return json({ ok: false, error: message }); }

  function activeComp() {
    var c = app.project.activeItem;
    return c && c instanceof CompItem ? c : null;
  }

  function fileOf(layer) {
    var src = layer.source;
    return src && src instanceof FootageItem && src.mainSource && src.mainSource.file ? src.mainSource.file : null;
  }

  // The selected footage layer in the active composition: its media file, where it
  // sits in the comp (start, in and out points, time stretch), and the comp's size.
  function selection() {
    var comp = activeComp(), sel, pick = null, i;
    if (!comp) return fail('Open a composition first.');
    sel = comp.selectedLayers;
    for (i = 0; i < sel.length; i++) if (fileOf(sel[i])) { pick = sel[i]; break; }
    if (!pick) return fail('Select the footage layer to caption first (a video with sound, not a precomp or a solid).');
    if (pick.timeRemapEnabled) return fail('That layer uses time remapping. Turn it off, or precompose the layer, then try again.');
    if (!(pick.stretch > 0)) return fail('Reversed layers can\'t be captioned. Select a layer that plays forwards.');
    return json({
      ok: true,
      project: app.project.file ? app.project.file.fsName : '',
      comp: { name: comp.name, width: comp.width, height: comp.height, fps: comp.frameRate, duration: comp.duration },
      layer: {
        name: pick.name, index: pick.index, path: fileOf(pick).fsName, startTime: pick.startTime,
        inPoint: pick.inPoint, outPoint: pick.outPoint, stretch: pick.stretch
      }
    });
  }

  // The captioned layer again (its index may have changed if layers were added).
  function target(comp, index, name) {
    var i;
    if (index <= comp.numLayers && comp.layer(index).name === name) return comp.layer(index);
    for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
  }

  // Put an item just above the layer, over the same span. A precomp of captions in
  // the source's own time takes the layer's start and stretch, so it stays in sync.
  function above(comp, item, layer, sameTime) {
    var l = comp.layers.add(item);
    l.moveBefore(layer);
    if (sameTime) { l.startTime = layer.startTime; l.stretch = layer.stretch; } else { l.startTime = layer.inPoint; }
    l.inPoint = layer.inPoint;
    l.outPoint = layer.outPoint;
    return l;
  }

  function build(D, index, name) {
    var comp = activeComp(), layer, pre, result, l;
    if (!comp) return fail('Open the composition with the captioned layer first.');
    layer = target(comp, index, name);
    if (!layer) return fail('The captioned layer isn\'t in the open composition. Open its composition and try again.');
    if (typeof CapstudioBuild !== 'function') return fail('The panel couldn\'t load its layer builder. Close and reopen the panel.');
    app.beginUndoGroup('Capstudio captions');
    try {
      pre = app.project.items.addComp(D.name, D.width, D.height, 1, D.duration, D.fps);
      result = CapstudioBuild(D, pre);
      l = above(comp, pre, layer, true);
    } finally {
      app.endUndoGroup();
    }
    return json({ ok: true, layers: result.count, missing: result.missing, name: l.name });
  }

  function placeFootage(path, index, name) {
    var comp = activeComp(), layer, item, l;
    if (!comp) return fail('Open the composition with the captioned layer first.');
    layer = target(comp, index, name);
    if (!layer) return fail('The captioned layer isn\'t in the open composition. Open its composition and try again.');
    app.beginUndoGroup('Capstudio captions');
    try {
      item = app.project.importFile(new ImportOptions(new File(path)));
      l = above(comp, item, layer, false);
    } finally {
      app.endUndoGroup();
    }
    return json({ ok: true, name: l.name });
  }

  return { selection: selection, build: build, placeFootage: placeFootage };
}());

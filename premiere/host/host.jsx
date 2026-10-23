/* Capstudio: the Premiere Pro side of the panel (ExtendScript, ES3).
 * The panel calls Capstudio.selection() to learn which clip to caption, and
 * Capstudio.place() to put the finished captions on the timeline. Every function
 * returns a JSON string: {"ok": true, ...} or {"ok": false, "error": "..."}. */
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

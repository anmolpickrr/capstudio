// The panel's bridge between the Capstudio app (in the frame) and Premiere Pro or
// After Effects (whichever the panel is open in).
//   app → panel  {type: 'capstudio:getClip', id}
//                → the selected clip (Premiere) or layer (After Effects), its sequence
//                  or composition, and its media file's bytes
//   app → panel  {type: 'capstudio:hello', id} → { version }
//   app → panel  {type: 'capstudio:getTimeline', id}
//                → every clip in the open sequence or composition (all tracks), where
//                  each sits, and each media file's bytes, once
//   app → panel  {type: 'capstudio:place', id, mov, movName, srt, start, end, above, project, index, name}
//                → the captions video (and SRT) saved next to the project and placed
//                  on the timeline, or above the layer
//   app → panel  {type: 'capstudio:aeBuild', id, builder, data, watermark, project, index, name}
//                → After Effects: the captions built as editable layers in a precomp
//                  above the layer (builder: static/ae/capstudio-ae.jsx)
// Replies are {type: 'capstudio:reply', id, ok, data | error}.
(function () {
  var SITE = document.documentElement.getAttribute('data-site');
  var MAX_BYTES = 1.5e9;
  var MAX_TIMELINE_BYTES = 4e9;

  // Premiere and the file system. Tests replace these with stand-ins.
  var host = window.__capstudioHost || (function () {
    var req = window.cep_node ? window.cep_node.require : window.require;
    var fs = req('fs'), path = req('path'), os = req('os');
    return {
      appName: function () {
        try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()).appName; } catch (e) { return 'PPRO'; }
      },
      evalScript: function (code) {
        return new Promise(function (resolve) { window.__adobe_cep__.evalScript(code, resolve); });
      },
      size: function (p) { return fs.statSync(p).size; },
      read: function (p) {
        return fs.promises.readFile(p).then(function (b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
      },
      write: function (p, bytes) { return fs.promises.writeFile(p, Buffer.from(bytes)); },
      mkdir: function (p) { fs.mkdirSync(p, { recursive: true }); },
      exists: function (p) { return fs.existsSync(p); },
      join: path.join, dirname: path.dirname, basename: path.basename,
      documents: function () { return path.join(os.homedir(), 'Documents'); },
    };
  }());

  var AE = host.appName() === 'AEFT';
  var HOST = AE ? 'CapstudioAE' : 'Capstudio';
  var frame = document.createElement('iframe');
  frame.title = 'Capstudio';
  frame.allow = 'clipboard-write; autoplay';
  frame.src = SITE + '/?host=' + (AE ? 'aftereffects' : 'premiere');
  document.body.appendChild(frame);
  var shown = false;
  function show() {
    if (shown) return;
    shown = true;
    frame.className = 'ready';
    document.getElementById('loading').className = 'loading done';
  }
  setTimeout(function () {
    if (!shown) document.getElementById('msg').innerHTML = 'Capstudio is starting up. This can take a minute. If it doesn\'t open, check your internet connection.';
  }, 8000);

  // JSON is valid ExtendScript once the two line-separator characters are escaped
  var SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  function literal(v) {
    return JSON.stringify(v).replace(SEPARATORS, function (c) { return '\\u' + c.charCodeAt(0).toString(16); });
  }

  function call(fn, args) {
    var code = HOST + '.' + fn + '(' + args.map(literal).join(',') + ')';
    return host.evalScript(code).then(function (raw) {
      var out;
      try { out = JSON.parse(raw); } catch (e) {
        throw new Error(raw && raw !== 'undefined' ? 'Premiere said: ' + raw : 'The panel couldn\'t talk to Premiere. Restart Premiere Pro and try again.');
      }
      if (!out.ok) throw new Error(out.error);
      return out;
    });
  }

  function reply(id, ok, payload, transfer) {
    var msg = { type: 'capstudio:reply', id: id, ok: ok };
    if (ok) msg.data = payload; else msg.error = payload;
    frame.contentWindow.postMessage(msg, SITE, transfer || []);
  }

  var TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', mxf: 'application/mxf' };

  function getClip(id) {
    return call('selection', []).then(function (sel) {
      var media = (sel.clip || sel.layer).path;
      var size = host.size(media);
      if (size > MAX_BYTES) throw new Error('That media file is over 1.5 GB. Export the part you need and caption that instead.');
      return host.read(media).then(function (bytes) {
        var name = host.basename(media), ext = (name.split('.').pop() || '').toLowerCase();
        reply(id, true, { app: AE ? 'aftereffects' : 'premiere', sequence: sel.sequence, clip: sel.clip, comp: sel.comp, layer: sel.layer,
          project: sel.project, fileName: name, fileType: TYPES[ext] || 'video/mp4', bytes: bytes }, [bytes]);
      });
    });
  }

  // The whole sequence or composition: its clips, with the files they use read once each.
  function getTimeline(id) {
    return call('timeline', []).then(function (tl) {
      var paths = [], index = {}, total = 0;
      tl.clips.forEach(function (c) {
        if (!(c.path in index)) { index[c.path] = paths.length; paths.push(c.path); }
        c.file = index[c.path];
      });
      paths.forEach(function (p) {
        var size = host.size(p);
        if (size > MAX_BYTES) throw new Error(host.basename(p) + ' is over 1.5 GB. Use a smaller copy of it, or caption one clip at a time.');
        total += size;
      });
      if (total > MAX_TIMELINE_BYTES) throw new Error('The media in this timeline adds up to more than 4 GB. Caption it in parts (select a clip), or use smaller copies.');
      return Promise.all(paths.map(function (p) { return host.read(p); })).then(function (all) {
        var files = paths.map(function (p, i) {
          var name = host.basename(p), ext = (name.split('.').pop() || '').toLowerCase();
          return { name: name, type: TYPES[ext] || 'application/octet-stream', bytes: all[i] };
        });
        var clips = tl.clips.map(function (c) { return { file: c.file, kind: c.kind, start: c.start, end: c.end, inPoint: c.inPoint, speed: c.speed, track: c.track }; });
        reply(id, true, { app: AE ? 'aftereffects' : 'premiere', project: tl.project, sequence: tl.sequence, duration: tl.duration,
          topTrack: tl.topTrack, skipped: tl.skipped, clips: clips, files: files }, all);
      });
    });
  }

  function folderFor(project) {
    var dir = host.join(project && /\.(prproj|aep|aepx)$/i.test(project) ? host.dirname(project) : host.documents(), 'Capstudio');
    host.mkdir(dir);
    return dir;
  }

  // A file name that doesn't overwrite an earlier export.
  function freeName(dir, name) {
    var dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    var p = host.join(dir, name), n = 2;
    while (host.exists(p)) p = host.join(dir, stem + ' (' + (n++) + ')' + ext);
    return p;
  }

  function place(id, m) {
    return Promise.resolve().then(function () {
      var dir = folderFor(m.project || '');
      var clean = function (s) { return String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'captions'; };
      var mov = freeName(dir, clean(m.movName));
      var srt = m.srt ? mov.replace(/\.mov$/i, '.srt') : '';
      return host.write(mov, m.mov)
        .then(function () { return srt ? host.write(srt, new TextEncoder().encode(m.srt)) : null; })
        .then(function () { return AE ? call('placeFootage', [mov, m.index, m.name]) : call('place', [mov, srt, m.start, m.end, m.above]); })
        .then(function (out) { reply(id, true, { track: out.track, captions: out.captions, file: mov }); });
    });
  }

  // After Effects: write the watermark next to the project, load the builder, and
  // build the captions as layers in a precomp above the captioned layer.
  function aeBuild(id, m) {
    return Promise.resolve().then(function () {
      var data = m.data;
      var steps = Promise.resolve();
      if (m.watermark && data.watermark) {
        var png = host.join(folderFor(m.project || ''), 'Capstudio ' + data.watermark.file);
        data.watermark.path = png;
        steps = host.write(png, m.watermark);
      }
      return steps
        .then(function () { return host.evalScript(m.builder.replace('/*CAPSTUDIO_DATA*/null', 'false')); })
        .then(function () { return call('build', [data, m.index, m.name]); })
        .then(function (out) { reply(id, true, { layers: out.layers, missing: out.missing, name: out.name }); });
    });
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== SITE || e.source !== frame.contentWindow) return;
    var m = e.data || {};
    if (m === 'capstudio-ready') return show();
    // which version of the panel this is (the site checks before using newer features)
    if (m.type === 'capstudio:hello') return reply(m.id, true, { version: 2 });
    var job = m.type === 'capstudio:getClip' ? getClip(m.id) : m.type === 'capstudio:getTimeline' ? getTimeline(m.id) : m.type === 'capstudio:place' ? place(m.id, m)
      : m.type === 'capstudio:aeBuild' ? aeBuild(m.id, m) : null;
    if (job) job.catch(function (err) { reply(m.id, false, err && err.message ? err.message : String(err)); });
  });
}());

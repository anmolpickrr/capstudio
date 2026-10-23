// The panel's bridge between the Capstudio app (in the frame) and Premiere Pro.
//   app → panel  {type: 'capstudio:getClip', id}
//                → reply with the sequence, the selected clip and its media file's bytes
//   app → panel  {type: 'capstudio:place', id, mov, movName, srt, start, end, above, project}
//                → the files are saved next to the project and placed on the timeline
// Replies are {type: 'capstudio:reply', id, ok, data | error}.
(function () {
  var SITE = document.documentElement.getAttribute('data-site');
  var MAX_BYTES = 1.5e9;

  // Premiere and the file system. Tests replace these with stand-ins.
  var host = window.__capstudioHost || (function () {
    var req = window.cep_node ? window.cep_node.require : window.require;
    var fs = req('fs'), path = req('path'), os = req('os');
    return {
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

  var frame = document.createElement('iframe');
  frame.title = 'Capstudio';
  frame.allow = 'clipboard-write; autoplay';
  frame.src = SITE + '/?host=premiere';
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

  function call(fn, args) {
    var code = 'Capstudio.' + fn + '(' + args.map(function (a) { return JSON.stringify(a); }).join(',') + ')';
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
      var size = host.size(sel.clip.path);
      if (size > MAX_BYTES) throw new Error('That clip\'s media file is over 1.5 GB. Export the part you need and caption that instead.');
      return host.read(sel.clip.path).then(function (bytes) {
        var name = host.basename(sel.clip.path), ext = (name.split('.').pop() || '').toLowerCase();
        reply(id, true, { sequence: sel.sequence, clip: sel.clip, project: sel.project, fileName: name,
          fileType: TYPES[ext] || 'video/mp4', bytes: bytes }, [bytes]);
      });
    });
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
      var project = m.project || '';
      var dir = host.join(project && /\.prproj$/i.test(project) ? host.dirname(project) : host.documents(), 'Capstudio');
      host.mkdir(dir);
      var clean = function (s) { return String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'captions'; };
      var mov = freeName(dir, clean(m.movName));
      var srt = m.srt ? mov.replace(/\.mov$/i, '.srt') : '';
      return host.write(mov, m.mov)
        .then(function () { return srt ? host.write(srt, new TextEncoder().encode(m.srt)) : null; })
        .then(function () { return call('place', [mov, srt, m.start, m.end, m.above]); })
        .then(function (out) { reply(id, true, { track: out.track, captions: out.captions, file: mov }); });
    });
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== SITE || e.source !== frame.contentWindow) return;
    var m = e.data || {};
    if (m === 'capstudio-ready') return show();
    var job = m.type === 'capstudio:getClip' ? getClip(m.id) : m.type === 'capstudio:place' ? place(m.id, m) : null;
    if (job) job.catch(function (err) { reply(m.id, false, err && err.message ? err.message : String(err)); });
  });
}());

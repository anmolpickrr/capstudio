// A stand-in for the parts of Premiere Pro's scripting DOM that the panel's host
// script (premiere/host/host.jsx) uses, for tests. Works in Node and in a browser.
// Every change it's asked to make is recorded in fake.log.
(function (root) {
  function makeFake(opts) {
    var log = [];
    var TB = 254016000000;
    function T(s) { return { seconds: s }; }
    function item(name, path, type) {
      return { name: name, type: type || 1, getMediaPath: function () { return path; } };
    }
    function children(list) { var c = { numItems: list.length }; for (var i = 0; i < list.length; i++) c[i] = list[i]; return c; }
    function trackItem(t) {
      return { name: t.name, mediaType: 'Video', projectItem: t.path !== undefined ? item(t.name, t.path) : null,
        start: T(t.start), end: T(t.end), inPoint: T(t.inPoint || 0),
        getSpeed: function () { return t.speed || 1; }, isSelected: function () { return !!t.selected; } };
    }
    var rootList = [];
    var rootItem = {
      get children() { return children(rootList); },
      createBin: function (name) {
        var list = [];
        var bin = { name: name, type: 2, get children() { return children(list); }, _list: list,
          getMediaPath: function () { return ''; } };
        rootList.push(bin);
        log.push(['createBin', name]);
        return bin;
      },
    };
    var tracks = opts.tracks.map(function (clips, ti) {
      var list = clips.map(trackItem);
      return {
        get clips() { return children(list); },
        overwriteClip: function (it, time) {
          log.push(['overwriteClip', ti, it.getMediaPath(), time]);
          list.push(trackItem({ name: it.name, path: it.getMediaPath(), start: time, end: time + 1 }));
          return true;
        },
      };
    });
    var seq = {
      name: opts.name || 'Reel', frameSizeHorizontal: opts.width, frameSizeVertical: opts.height,
      timebase: String(Math.round(TB / opts.fps)),
      getSelection: function () {
        var out = [];
        tracks.forEach(function (t) { for (var i = 0; i < t.clips.numItems; i++) if (t.clips[i].isSelected()) out.push(t.clips[i]); });
        return out;
      },
      videoTracks: (function () { var v = { numTracks: tracks.length }; tracks.forEach(function (t, i) { v[i] = t; }); return v; }()),
      createCaptionTrack: function (it, start, fmt) { log.push(['createCaptionTrack', it.getMediaPath(), start, fmt]); return true; },
    };
    var app = {
      project: {
        path: opts.projectPath || '', activeSequence: opts.noSequence ? null : seq, rootItem: rootItem,
        importFiles: function (paths, suppress, bin, numbered) {
          log.push(['importFiles', paths[0], bin.name]);
          bin._list.push(item(paths[0].split(/[\\/]/).pop(), paths[0]));
          return true;
        },
      },
    };
    return { app: app, ProjectItemType: { CLIP: 1, BIN: 2, ROOT: 3, FILE: 4 }, Sequence: { CAPTION_FORMAT_SUBTITLE: 4 }, log: log };
  }
  root.makeFakePremiere = makeFake;
}(this));

var fs = require('fs');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var _ = require("underscore");

var utils = require("./utils");


var Listener = function (path, conn) {
  var self = this;

  self.path = path;
  self.conn = conn;
  self.watch(function (err, result) {
    console.log("EVERYTHING IS BEING WATCHED");
    conn.listener_ready(self);
  });
  self.bufs = {};
  self.dirs = {};
  self.watchers = {};
  self.expected_changes = {};
};

Listener.prototype.listener = function (_path, is_dir, event, filename) {
  var self = this,
    patches,
    current_text,
    md5,
    buf = self.bufs[_path],
    real_path = path.join(self.path, _path);

  console.log(event, real_path, is_dir);
  if (is_dir || event === 'rename') {
    return;
  }
  if (!buf){
    return console.log('should share ' + real_path + "but I'm too stupid");
  }

  // try{
    current_text = fs.readFileSync(real_path);
    md5 = utils.md5(current_text);
    if (md5 === buf.md5){
      return console.info('got expected change');
    }
    patches = DMP.patch_make(buf.buf.toString(), current_text.toString());
    // self.conn.send_patch()
    // console.log(DMP.patch_toText(patches));
  // }  catch (e){
  //   console.error(e);
  // }

  // conn.write();
};

Listener.prototype.add_listener = function (f, is_dir, cb) {
  var self = this,
    rel_path = path.relative(self.path, f);

  is_dir = is_dir === true ? true : false;

  if (is_dir){
    fs.watch(f, self.listener.bind(self, rel_path, is_dir));
    self.dirs[rel_path] = true;
    return cb();
  }


  fs.readFile(f, function (err, buf) {
    if (err){
      return cb(err);
    }
    self.bufs[rel_path] = {buf: buf, md5: utils.md5(buf.toString())};
    // not sure possibly 50K closures is a good idea, but it works for HN...
    fs.watch(f, self.listener.bind(self, rel_path, is_dir));
    cb();
  });
};

Listener.prototype.watch = function (cb) {
  var self = this;

  async.auto({
    paths: function (cb) {
      utils.walk_dir(self.path, cb);
    },
    dirs: ['paths', function (cb, res) {
      async.eachLimit(_.values(res.paths.dirs), 20, function (filename, cb) {
        self.add_listener(filename, true, cb);
      }, cb);
    }],
    files: ['paths', function (cb, res) {
      async.eachLimit(_.values(res.paths.files), 20, function (filename, cb) {
        self.add_listener(filename, false, cb);
      }, cb);
    }]
  }, function (err, result) {
    if (err) {
      console.error(err);
      return cb(err, result);
    }
    return cb(err, result);
  });
};

Listener.prototype.patch = function(_path, patch_text, md5, id) {
  var self = this,
    res,
    self_md5_after,
    patches,
    buf = self.bufs[_path];

  if (!buf){
    return self.conn.send_get_buf(id);
  }

  try {
    patches = DMP.patch_fromText(patch_text);
  } catch (e) {
    log.error("Couldn't parse patch text:", patch_text, "\nException:", e);
    return self.conn.disconnect("Unable to parse the patch you sent.");
  }
  if (patches.length === 0) {
    return log.log("Patch is empty.");
  }

  res = DMP.patch_apply(patches, buf.buf.toString());
  if (!utils.patched_cleanly(res)){
    return self.conn.send_get_buf(id);
  }

  self_md5_after = utils.md5(res[0]);
  if (self_md5_after !== md5){
    console.log('md5s don\'t match');
    return self.conn.send_get_buf(id);
  }

  self.write(_path, md5, res[0]);

};

Listener.prototype.write = function(_path, md5, buf){
  var self = this,
    existing = self.bufs[_path],
    realpath = path.join(self.path, _path);

  if (existing && existing.md5 === md5){
    return;
  }

  fs.writeFile(realpath, buf, function(err){
    if (err){
      return console.error('could not write file: ' + realpath + ' because ' + toString(err));
    }
    existing.buf = new Buffer(buf);
    existing.md5 = md5;
  });
};
exports.Listener = Listener;

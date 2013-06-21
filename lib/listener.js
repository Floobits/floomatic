var fs = require('fs');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var _ = require("underscore");

var watchers = {};
var bufs = {};


var Listener = function (path, conn) {
  var self = this;

  self.conn = conn;
  self.watch(path);
};

Listener.prototype.listener = function (original_path, is_dir, event, filename) {
  var self = this,
    buf,
    patches;
  console.log(event, original_path, is_dir);
  if (is_dir || event === 'rename') {
    return;
  }
  buf = fs.readFileSync(original_path);
  console.log(buf.toString(), bufs[original_path].toString());
  patches = DMP.patch_make(bufs[original_path].toString(), buf.toString());
  console.log(DMP.patch_toText(patches));
  // conn.write();
};

Listener.prototype.add_listener = function(f, is_dir) {
  var self = this;
  is_dir = is_dir === true ? true : false;
  fs.readFile(f, function (err, buf) {
    bufs[f] = buf;
    // not sure possibly 50K closures is a good idea, but it works for HN...
    fs.watch(f, self.listener.bind(self, f, is_dir));
  });
};


Listener.prototype.watch = function (to_watch) {
  var self = this,
    sub_dirs = [],
    files = [],
    iter,
    children = fs.readdirSync(to_watch).map(function (child) {
      return path.join(to_watch, child);
    });

  iter = function (p, cb) {
    console.log(p);
    fs.lstat(p, function (err, stats) {
      if (stats.isDirectory()) {
        sub_dirs.push(p);
      } else if (stats.isFile()) {
        files.push(p);
      }
      return cb();
    });
  };

  async.eachLimit(children, 10, iter, function (err) {
    sub_dirs.forEach(self.watch.bind(self));
    files.forEach(self.add_listener.bind(self));
    self.add_listener(to_watch, true);
  });
};

exports.Listener = Listener;

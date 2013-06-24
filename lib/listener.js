var fs = require('fs');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var mkdirp = require("mkdirp");
var _ = require("underscore");

var utils = require("./utils");


var Listener = function (_path, conn, cb) {
  var self = this;

  self.path = _path;
  self.conn = conn;
  self.bufs = {};
  self.watcher = null;
  self.expected_changes = {};
  self.ignore_patterns = ["node_modules"];

  self.watch(_path, function (err, result) {
    console.log("EVERYTHING IS BEING WATCHED");
    cb(err);
  });
};

Listener.prototype.listener = function (event, rel_path) {
  var self = this,
    patches,
    current,
    md5,
    buf_path = path.join(self.path, rel_path),
    buf = self.bufs[rel_path];

  console.log(event, rel_path);

  if (event === 'rename') {
    return utils.walk_dir(path.dirname(rel_path), function (err, paths) {
      _.each(paths.files, function (f) {
        var rel_path = path.relative(self.path, f);

        if (!_.has(self.bufs, rel_path)) {
          current = fs.readFileSync(f, 'utf-8');
          md5 = utils.md5(current);
          self.conn.send_create_buf(rel_path, current, md5);
          self.bufs[rel_path] = {md5: md5};
        }
      });
      // _.each()
      // debugger;
    });
  }

  current = fs.readFileSync(buf_path);
  md5 = utils.md5(current);

  if (!buf) {
    console.log("buf for path", rel_path, "doesn't exist. creating...");
    return self.conn.send_create_buf(rel_path, current, md5);
  }

  if (buf.buf === undefined) {
    return console.log('ignoring change');
  }

  if (md5 === buf.md5) {
    return console.info('got expected change');
  }

  console.log('new md5 is', md5);
  patches = DMP.patch_make(buf.buf.toString(), current.toString());
  self.conn.write('patch', {
    'id': buf.id,
    'md5_after': md5,
    'md5_before': buf.md5,
    'path': rel_path,
    'patch': DMP.patch_toText(patches)
  });
  buf.buf = current;
  buf.md5 = md5;
};

Listener.prototype.add_listener = function (f) {
  var self = this;

  if (self.watcher) {
    throw new Error('I\'m already watching stuff');
  }

  self.watcher = fs.watch(f, self.listener.bind(self));
};

Listener.prototype.watch = function (dir, cb) {
  var self = this;

  async.auto({
    paths: function (cb) {
      utils.walk_dir(dir, cb);
    },
    files: ['paths', function (cb, res) {
      async.eachLimit(_.values(res.paths.files), 20, function (f, cb) {
        fs.readFile(f, function (err, buf) {
          var rel_path = path.relative(self.path, f);
          if (err) {
            return cb(err);
          }
          console.log('added', f);
          self.bufs[rel_path] = {buf: buf, md5: utils.md5(buf.toString())};
          cb();
        });
      }, cb);
    }]
  }, function (err, result) {
    if (err) {
      console.error(err);
    }
    self.add_listener(dir);
    cb();
  });
};

Listener.prototype.patch = function (_path, patch_text, md5, id) {
  var self = this,
    res,
    self_md5_after,
    patches,
    buf = self.bufs[_path];

  if (!buf) {
    return self.conn.send_get_buf(id);
  }
  if (buf.buf === undefined) {
    return;
  }

  try {
    patches = DMP.patch_fromText(patch_text);
  } catch (e) {
    console.error("Couldn't parse patch text:", patch_text, "\nException:", e);
    return self.conn.disconnect("Unable to parse the patch you sent.");
  }
  if (patches.length === 0) {
    return console.log("Patch is empty.");
  }

  res = DMP.patch_apply(patches, buf.buf.toString());
  if (!utils.patched_cleanly(res)) {
    return self.conn.send_get_buf(id);
  }

  self_md5_after = utils.md5(res[0]);
  if (self_md5_after !== md5) {
    console.log('md5s don\'t match');
    return self.conn.send_get_buf(id);
  }

  self.write(_path, md5, res[0]);
};

Listener.prototype.rename = function (old_path, new_path) {
  var self = this,
    buf = self.bufs[old_path];

  delete self.bufs[old_path];
  self.bufs[new_path] = buf;
  mkdirp.sync(path.dirname(new_path));
  fs.renameSync(old_path, new_path);
};

Listener.prototype.delete_buf = function (_path) {
  var self = this,
    buf = self.bufs[_path],
    realpath = path.join(self.path, _path);

  delete self.bufs[buf];
  fs.unlinkSync(realpath);

};

Listener.prototype.write = function (_path, buf, md5) {
  var self = this,
    existing = self.bufs[_path],
    fd,
    realpath = path.join(self.path, _path);

  if (existing && existing.buf !== undefined && existing.md5 === md5) {
    return;
  }
  existing.buf = new Buffer(buf);
  existing.md5 = md5;
  console.log('the md5 will be', md5);
  mkdirp.sync(path.dirname(realpath));
  fd = fs.openSync(realpath, 'w');
  fs.writeSync(fd, buf);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  // fs.writeFile(realpath, buf, function (err) {
  //   if (err) {
  //     // TODO: add listeners sometimes here
  //     return console.error('could not write file: ' + realpath + ' because ' + err.toString());
  //   }
  // });
};

exports.Listener = Listener;

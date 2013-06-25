/*global unescape: false */
var fs = require('fs');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var mkdirp = require("mkdirp");
var _ = require("underscore");

var log = require("./log");
var utils = require("./utils");


var Listener = function (_path, conn, hooks) {
  var self = this;

  self.path = _path;
  self.conn = conn;
  self.bufs = {};
  self.watcher = null;
  self.expected_changes = {};
  self.ignore_patterns = ["node_modules"];
  self.hooks = hooks;
};

Listener.prototype.listener = function (event, rel_path) {
  var self = this,
    patches,
    current,
    md5,
    buf_path = path.join(self.path, rel_path),
    buf = self.bufs[rel_path];

  log.log(event, rel_path);

  if (event === 'rename') {
    return utils.walk_dir(path.dirname(rel_path), function (err, paths) {
      _.each(paths.files, function (f) {
        var rel_path = path.relative(self.path, f);

        if (!_.has(self.bufs, rel_path)) {
          /*jslint stupid: true */
          current = fs.readFileSync(f);
          /*jslint stupid: false */
          md5 = utils.md5(current);
          self.conn.send_create_buf(rel_path, current.toString(), md5);
          self.bufs[rel_path] = {md5: md5};
        }
      });
      _.each(self.bufs, function (buf, _path) {

      });
      // _.each()
      // debugger;
    });
  }

  /*jslint stupid: true */
  current = fs.readFileSync(buf_path);
  /*jslint stupid: false */
  md5 = utils.md5(current);

  if (!buf) {
    log.log("buf for path", rel_path, "doesn't exist. creating...");
    return self.conn.send_create_buf(rel_path, current.toString(), md5);
  }

  if (buf.buf === undefined) {
    return log.log('ignoring change');
  }

  if (md5 === buf.md5) {
    return log.debug('got expected change');
  }

  log.log('new md5 is', md5);

  self.conn.send_patch(buf, current.toString());
};

Listener.prototype.fs_watch = function () {
  var self = this;

  if (self.watcher) {
    throw new Error('I\'m already watching stuff');
  }

  log.log("Watching " + self.path);
  self.watcher = fs.watch(self.path, self.listener.bind(self));
};

Listener.prototype.inspect = function (cb) {
  var self = this;

  async.auto({
    paths: function (cb) {
      utils.walk_dir(self.path, cb);
    },
    files: ['paths', function (cb, res) {
      async.eachLimit(_.values(res.paths.files), 20, function (f, cb) {
        fs.readFile(f, function (err, buf) {
          var rel_path;

          if (err) {
            return cb(err);
          }
          log.log('added', f);

          rel_path = path.relative(self.path, f);
          self.bufs[rel_path] = {buf: buf, md5: utils.md5(buf)};
          cb();
        });
      }, cb);
    }]
  }, cb);
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
    log.error("Couldn't parse patch text:", patch_text, "\nException:", e);
    return self.conn.disconnect("Unable to parse the patch you sent.");
  }
  if (patches.length === 0) {
    return log.log("Patch is empty.");
  }

  res = DMP.patch_apply(patches, buf.buf.toString());
  if (!utils.patched_cleanly(res)) {
    return self.conn.send_get_buf(id);
  }

  self_md5_after = utils.md5(unescape(encodeURIComponent(res[0])));
  if (self_md5_after !== md5) {
    log.log('md5s don\'t match. expected', md5, 'but md5 was', self_md5_after);
    return self.conn.send_get_buf(id);
  }
  // log.debug('Patching', _path, 'with:\n', patch_text);
  self.write(_path, res[0], md5);
};

Listener.prototype.rename = function (old_path, new_path) {
  var self = this,
    buf = self.bufs[old_path];

  delete self.bufs[old_path];
  self.bufs[new_path] = buf;
  mkdirp.sync(path.dirname(new_path));
  /*jslint stupid: true */
  fs.renameSync(old_path, new_path);
  /*jslint stupid: false */
};

Listener.prototype.delete_buf = function (_path) {
  var self = this,
    buf = self.bufs[_path],
    realpath = path.join(self.path, _path);

  delete self.bufs[buf];
  fs.unlink(realpath, function (err, result) {
    if (err) {
      log.warn('Tried to delete', _path, 'but I couldn\'t because', err);
    }
  });
};

Listener.prototype.write = function (_path, buf, md5) {
  var self = this,
    existing = self.bufs[_path],
    fd,
    realpath = path.join(self.path, _path);

  if (existing && existing.buf !== undefined && existing.md5 === md5) {
    return;
  }

  if (!existing) {
    existing = {path: _path};
    self.bufs[_path] = existing;
  }
  existing.buf = new Buffer(buf);
  existing.md5 = md5;
  log.debug("Writing", _path, "md5", md5);

  mkdirp(path.dirname(realpath), function (err) {
    if (err) {
      log.warn(err);
    }
    fs.writeFile(realpath, buf, function (err) {
      if (err) {
        return log.error(err);
      }
      self.hooks.call(_path, existing.buf);
    });
  });
};

module.exports = Listener;

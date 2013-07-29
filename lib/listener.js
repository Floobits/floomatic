var fs = require('fs');
var path = require('path');
var util = require('util');

var async = require('async');
var DMP;
var diff_match_patch = require('diff_match_patch');
var JS_DMP = new diff_match_patch.diff_match_patch();
var mkdirp = require("mkdirp");
var _ = require("lodash");

var log = require("./log");
var ignores = require("./ignores");
var utils = require("./utils");


try {
  DMP = require("native-diff-match-patch");
} catch (e) {
  log.warn("No native-diff-match-patch. You won't be able to patch binary files.");
}


var Listener = function (_path, conn, hooks) {
  var self = this;

  self.path = _path;
  self.conn = conn;
  self.bufs = {};
  self.paths_to_ids = {};
  self.watcher = null;
  self.expected_changes = {};
  self.ignore_patterns = ["node_modules"];
  self.hooks = hooks;
};

Listener.prototype.buf_by_path = function (rel_path) {
  var self = this,
    buf_id = self.paths_to_ids[rel_path];

  if (!buf_id) {
    log.log("buf not found for path", rel_path);
    log.log(self.paths_to_ids);
  }
  if (!self.bufs[buf_id]) {
    log.log("buf is in paths_to_ids, but not in self.bufs", rel_path, buf_id);
    log.log(self.bufs);
  }
  return self.bufs[buf_id];
};

Listener.prototype.listener = function (event, rel_path) {
  var self = this,
    patches,
    current,
    md5,
    buf_path = path.join(self.path, rel_path),
    buf = self.buf_by_path(rel_path);

  log.log(event, rel_path);

  if (event === 'rename') {
    return;
  }

  if (!buf) {
    log.log("buf for path", rel_path, "doesn't exist. creating...");
    return self.create_buf(buf_path);
  }

  if (buf.buf === undefined) {
    return log.log('ignoring change');
  }

  /*jslint stupid: true */
  current = fs.readFileSync(buf_path);
  /*jslint stupid: false */

  md5 = utils.md5(current);
  if (md5 === buf.md5) {
    return log.debug('got expected change');
  }

  log.log('new md5 is', md5);

  self.conn.send_patch(buf, current);
};

Listener.prototype.fs_watch = function () {
  var self = this;

  if (self.watcher) {
    throw new Error('I\'m already watching stuff');
  }

  log.log("Watching " + self.path);
  self.watcher = fs.watch(self.path, self.listener.bind(self));
};

Listener.prototype.create_buf = function (_path, ig) {
  var self = this,
    stats,
    buf,
    encoding,
    existing,
    rel_path,
    paths;

  /*jslint stupid: true */
  stats = fs.lstatSync(_path);
  /*jslint stupid: false */
  if (stats.isSymbolicLink()) {
    return log.error('Skipping adding %s because it is a symlink.', _path);
  }

  if (ig && ig.is_ignored(_path)) {
    return;
  }

  if (stats.isFile()) {
    rel_path = path.relative(self.path, _path);
    existing = self.buf_by_path(rel_path);
    if (existing) {
      return;
    }
    /*jslint stupid: true */
    buf = fs.readFileSync(_path);
    /*jslint stupid: false */
    encoding = utils.is_binary(buf) ? 'base64' : 'utf8';
    return self.conn.send_create_buf({
      'buf': buf.toString(encoding),
      'encoding': encoding,
      'md5': utils.md5(buf),
      'path': rel_path
    });
  }

  if (!stats.isDirectory()) {
    return;
  }

  if (!ig) {
    ig = ignores.build_ignores(_path, self.path);
  }

  /*jslint stupid: true */
  paths = fs.readdirSync(_path);
  /*jslint stupid: false */

  _.each(paths, function (p) {
    var p_path = path.join(_path, p),
      ignored,
      child_ig,
      stats;

    if (p[0] === '.' && !_.contains(ignores.HIDDEN_WHITELIST, p)) {
      return log.log('Not creating buf for hidden path', p_path);
    }
    ignored = ig.is_ignored(p_path);
    if (ignored) {
      return log.log(util.format('Not adding %s because path is ignored.', p_path));
    }
    /*jslint stupid: true */
    stats = fs.lstatSync(p_path);
    /*jslint stupid: false */
    if (stats.isDirectory()) {
      child_ig = new ignores.Ignore(ig, p_path);
      self.create_buf(p_path, child_ig);
    } else {
      self.create_buf(p_path, ig);
    }
  });
  return;
};

Listener.prototype.patch = function (_path, patch_text, md5, id) {
  var self = this,
    res,
    self_md5_after,
    patches,
    buf = self.bufs[id];

  if (!buf) {
    return self.conn.send_get_buf(id);
  }
  if (buf.buf === undefined) {
    return;
  }

  if (DMP) {
    try {
      res = DMP.patch_apply(patch_text, buf.encoding === 'utf8' ? buf.buf.toString() : buf.buf);
    } catch (e) {
      log.error("Couldn't parse patch text:", patch_text, "\nException:", e);
      return self.conn.disconnect("Unable to parse the patch sent from the server.");
    }
  } else if (buf.encoding === "utf8") {
    try {
      patches = JS_DMP.patch_fromText(patch_text);
    } catch (e2) {
      log.error("Couldn't parse patch text:", patch_text, "\nException:", e2);
      return self.conn.disconnect("Unable to parse the patch sent from the server.");
    }
    if (patches.length === 0) {
      return log.log("Patch is empty.");
    }
    res = JS_DMP.patch_apply(patches, buf.buf.toString());
  } else {
    // TODO: don't send a billion get_bufs
    return self.conn.send_get_buf(id);
  }

  if (!utils.patched_cleanly(res)) {
    log.warn(util.format("Re-fetching %s because it wasn't patched cleanly.", buf.path));
    return self.conn.send_get_buf(id);
  }

  self_md5_after = utils.md5(res[0]);
  if (self_md5_after !== md5) {
    log.log('md5s don\'t match. expected', md5, 'but md5 was', self_md5_after);
    return self.conn.send_get_buf(id);
  }

  if (!Buffer.isBuffer(res[0])) {
    res[0] = new Buffer(res[0]);
  }

  buf.buf = res[0];
  buf.md5 = md5;

  self.write(buf);
};

Listener.prototype.rename = function (old_path, new_path) {
  var self = this,
    buf = self.buf_by_path(old_path);

  delete self.paths_to_ids[old_path];
  self.paths_to_ids[new_path] = buf;
  buf.path = new_path;
  mkdirp.sync(path.dirname(new_path));
  /*jslint stupid: true */
  fs.renameSync(old_path, new_path);
  /*jslint stupid: false */
};

Listener.prototype.delete_buf = function (_path) {
  var self = this,
    buf = self.paths_to_ids(_path),
    realpath = path.join(self.path, _path);

  delete self.bufs[buf.id];
  delete self.paths_to_ids[_path];

  fs.unlink(realpath, function (err, result) {
    if (err) {
      log.warn('Tried to delete', _path, 'but I couldn\'t because', err);
    }
  });
};

Listener.prototype.write = function (buf) {
  var self = this,
    fd,
    realpath = path.join(self.path, buf.path);

  log.log("Writing", buf.path);

  mkdirp(path.dirname(realpath), function (err) {
    if (err) {
      log.warn(err);
    }
    fs.writeFile(realpath, buf.buf, {encoding: buf.encoding}, function (err) {
      if (err) {
        return log.error(err);
      }
      // self.hooks.on_write(_path, existing.buf);
    });
  });
};

module.exports = Listener;

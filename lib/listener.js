"use strict";

var fs = require("fs");
var path = require("path");
var util = require("util");

var DMP;
var TMP_DMP = require("dmp");
var JS_DMP = new TMP_DMP();
var log = require("floorine");
var mkdirp = require("mkdirp");
var _ = require("lodash");

var ignores = require("./ignores");
var utils = require("./utils");

var fsevents;
var Listener;

try {
  DMP = require("native-diff-match-patch");
} catch (ignore) {
  // Ignore
}

if (process.platform === "darwin") {
  try {
    fsevents = require("fsevents");
  } catch (ignore) {
    // Ignore
  }
}


Listener = function (_path, conn, hooks) {
  var self = this;

  self.path = _path;
  self.conn = conn;
  self.bufs = {};
  self.paths_to_ids = {};
  self.watchers = {};
  self.expected_changes = [];
  self.ignore_patterns = ["node_modules"];
  self.hooks = hooks;

  if (!DMP) {
    log.warn("No native-diff-match-patch. You won't be able to patch binary files.");
  }
  if (process.platform === "darwin" && !fsevents) {
    log.warn("Error requiring fsevents. This is not good!");
  }
};

Listener.prototype.buf_by_path = function (rel_path) {
  var self = this,
    buf_id = self.paths_to_ids[rel_path];

  return self.bufs[buf_id];
};

Listener.prototype.listener = function (parent_path, event, rel_to_parent_path) {
  var self = this,
    abs_path = path.join(parent_path, rel_to_parent_path),
    buf_path = path.relative(self.path, abs_path),
    buf = self.buf_by_path(buf_path);

  log.log("%s was %sd", buf_path, event);

  if (event === "rename") {
    /* rename can fire under the following:
      thing was renamed
      new file was created
      file was moved
      file was deleted
    */
    self.on_create(abs_path, buf);
    return;
  }

  if (!buf) {
    self.create_buf(abs_path);
    return;
  }

  if (buf.buf === undefined) {
    log.log("ignoring change");
    return;
  }

  self.on_change(abs_path, buf);
};

Listener.prototype.watch_path = function (_path, ig) {
  var self = this;

  if (self.watchers[_path]) {
    log.debug("Already watching", _path);
    return;
  }

  if (ig && ig.is_ignored(_path)) {
    return;
  }
  if (!ig) {
    ig = ignores.build_ignores(_path, self.path);
  }

  if (!fsevents) {
    self.node_watch_path(_path, ig);
    return;
  }
  if (!_.isEmpty(self.watchers)) {
    log.debug("Already have a watcher, ignoring watch request for", _path);
    return;
  }
  self.osx_watch_path(_path, ig);
};

Listener.prototype.on_create = function (abs_path, buf) {
  var self = this,
    current,
    md5,
    stats;

  log.log("Created", abs_path);

  try {
    /*eslint-disable no-sync */
    stats = fs.lstatSync(abs_path);
    /*eslint-enable no-sync */
    if (stats.isDirectory()) {
      self.watch_path(abs_path);
      return;
    }
    if (!stats.isFile()) {
      return;
    }
  } catch (e) {
    if (buf) {
      self.on_delete(abs_path, buf);
    }
    return;
  }

  if (!buf) {
    self.create_buf(abs_path);
    return;
  }

  try {
    /*eslint-disable no-sync */
    current = fs.readFileSync(abs_path);
    /*eslint-enable no-sync */
  } catch (err) {
    log.error("Can't read file but could stat it.  What does that mean?", err);
    return;
  }
  md5 = utils.md5(current);

  // change contents sometimes (underlying inode was stomped)
  if (buf.md5 === md5) {
    return;
  }

  self.conn.send_patch(buf, current);
};

Listener.prototype.on_change = function (abs_path, buf) {
  var self = this,
    current,
    md5;

  if (!buf) {
    return;
  }

  /*eslint-disable no-sync */
  current = fs.readFileSync(abs_path);
  /*eslint-enable no-sync */

  md5 = utils.md5(current);
  if (md5 === buf.md5) {
    log.debug("got expected change");
    return;
  }

  log.log("new md5 is", md5);

  self.conn.send_patch(buf, current);
};

Listener.prototype.on_delete = function (abs_path, buf) {
  var self = this,
    dir_rel_path;

  if (!buf) {
    dir_rel_path = path.relative(self.path, abs_path);
    _.each(self.paths_to_ids, function (id, rel_path) {
      if (rel_path.substring(0, dir_rel_path.length) === dir_rel_path) {
        log.debug("Deleting %s", rel_path);
        self.conn.send_delete_buf(id);
      }
    });
    return;
  }

  log.debug("Deleted %s", abs_path);
  self.conn.send_delete_buf(buf.id);
};

Listener.prototype.on_rename = function (abs_path, buf) {
  if (buf) {
    log.debug("Renamed %s %s", abs_path, buf.id);
  }
};

Listener.prototype.osx_watch_path = function (_path) {
  var self = this,
    get_buf,
    watcher = fsevents(_path);

  get_buf = function (abs_path) {
    var buf_path = path.relative(self.path, abs_path),
      buf = self.buf_by_path(buf_path);

    return [abs_path, buf];
  };

  watcher.on("created", function (abs_path) {
    self.on_create.apply(self, get_buf(abs_path));
  });

  watcher.on("deleted", function (abs_path) {
    self.on_delete.apply(self, get_buf(abs_path));
  });

  watcher.on("modified", function (abs_path) {
    self.on_change.apply(self, get_buf(abs_path));
  });

  watcher.on("moved-out", function (abs_path) {
    self.on_rename.apply(self, get_buf(abs_path));
  });

  watcher.on("moved-in", function (abs_path) {
    self.on_rename.apply(self, get_buf(abs_path));
  });

  self.watchers[_path] = watcher;
};

Listener.prototype.node_watch_path = function (_path, ig) {
  var self = this,
    paths,
    stats;

  /*eslint-disable no-sync */
  stats = fs.lstatSync(_path);
  /*eslint-enable no-sync */
  if (stats.isSymbolicLink()) {
    return log.error("Skipping adding %s because it is a symlink.", _path);
  }

  self.watchers[_path] = fs.watch(_path, self.listener.bind(self, _path));

  /*eslint-disable no-sync */
  paths = fs.readdirSync(_path);
  /*eslint-enable no-sync */

  _.each(paths, function (p) {
    var p_path = path.join(_path, p),
      ignored,
      child_ig;

    if (p[0] === "." && !_.includes(ignores.HIDDEN_WHITELIST, p)) {
      return log.log("Not creating buf for hidden path", p_path);
    }
    ignored = ig.is_ignored(p_path);
    if (ignored) {
      return log.log(util.format("Not adding %s because path is ignored.", p_path));
    }
    /*eslint-disable no-sync */
    stats = fs.lstatSync(p_path);
    /*eslint-enable no-sync */
    if (stats.isDirectory()) {
      child_ig = new ignores.Ignore(ig, p_path);
      self.watch_path(p_path, child_ig);
    }
  });
};

Listener.prototype.create_buf = function (_path, ig) {
  var self = this,
    stats,
    buf,
    encoding,
    existing,
    ig_path,
    rel_path,
    paths;

  if (self.expected_changes.indexOf(_path) >= 0) {
    log.log("File %s is already being created", _path);
    return;
  }

  self.expected_changes.push(_path);

  try {
    /*eslint-disable no-sync */
    stats = fs.lstatSync(_path);
    /*eslint-enable no-sync */
  } catch (e) {
    log.error(util.format("Error statting %s: %s", _path, e.toString()));
    return;
  }
  if (stats.isSymbolicLink()) {
    log.error("Skipping adding %s because it is a symlink.", _path);
    return;
  }

  if (!ig) {
    if (stats.isDirectory()) {
      ig_path = _path;
    } else {
      ig_path = path.dirname(_path);
    }
    ig = ignores.build_ignores(ig_path, self.path);
  }

  if (ig.is_ignored(_path)) {
    return;
  }

  if (stats.isFile()) {
    rel_path = path.relative(self.path, _path);
    existing = self.buf_by_path(rel_path);
    if (existing) {
      return;
    }

    try {
      /*eslint-disable no-sync */
      buf = fs.readFileSync(_path);
      /*eslint-enable no-sync */
    } catch (e2) {
      log.error(util.format("Error readFileSync %s: %s", _path, e2.toString()));
      return;
    }
    encoding = utils.is_binary(buf) ? "base64" : "utf8";
    self.conn.send_create_buf({
      "buf": buf.toString(encoding),
      "encoding": encoding,
      "md5": utils.md5(buf),
      "path": rel_path
    });
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  try {
    /*eslint-disable no-sync */
    paths = fs.readdirSync(_path);
    /*eslint-enable no-sync */
  } catch (e3) {
    log.error(util.format("Error readdiring %s: %s", _path, e3.toString()));
    return;
  }

  _.each(paths, function (p) {
    var p_path = path.join(_path, p),
      ignored,
      child_ig;

    if (p[0] === "." && !_.includes(ignores.HIDDEN_WHITELIST, p)) {
      log.log("Not creating buf for hidden path", p_path);
      return;
    }
    ignored = ig.is_ignored(p_path);
    if (ignored) {
      log.log(util.format("Not adding %s because path is ignored.", p_path));
      return;
    }

    try {
      /*eslint-disable no-sync */
      stats = fs.lstatSync(p_path);
      /*eslint-enable no-sync */
    } catch (e) {
      log.error(util.format("Error lstatSync %s: %s", p_path, e.toString()));
      return;
    }
    if (stats.isDirectory()) {
      child_ig = new ignores.Ignore(ig, p_path);
      self.create_buf(p_path, child_ig);
    } else {
      self.create_buf(p_path, ig);
    }
  });
  return;
};

Listener.prototype.patch = function (patch_text, md5, id) {
  var self = this,
    res,
    self_md5_after,
    patches,
    buf = self.bufs[id];

  if (!buf) {
    self.conn.send_get_buf(id);
    return;
  }
  if (buf.buf === undefined) {
    return;
  }

  if (buf.encoding === "utf8") {
    try {
      patches = JS_DMP.patch_fromText(patch_text);
    } catch (e2) {
      log.error("Couldn't parse patch text from server:", patch_text, "\nException:", e2);
      process.exit(1);
      return;
    }
    if (patches.length === 0) {
      log.log("Patch is empty.");
      return;
    }
    res = JS_DMP.patch_apply(patches, buf.buf.toString());
  } else if (DMP) {
    try {
      res = DMP.patch_apply(patch_text, buf.encoding === "utf8" ? buf.buf.toString() : buf.buf);
    } catch (e) {
      log.error("Couldn't parse patch text from server:", patch_text, "\nException:", e);
      process.exit(1);
      return;
    }
  } else {
    // TODO: don't send a billion get_bufs
    self.conn.send_get_buf(id);
    return;
  }

  if (!utils.patched_cleanly(res)) {
    log.warn(util.format("Re-fetching %s because it wasn't patched cleanly.", buf.path));
    self.conn.send_get_buf(id);
    return;
  }

  self_md5_after = utils.md5(res[0]);
  if (self_md5_after !== md5) {
    log.log("md5s don't match. expected", md5, "but md5 was", self_md5_after);
    self.conn.send_get_buf(id);
    return;
  }

  if (!Buffer.isBuffer(res[0])) {
    res[0] = new Buffer(res[0]);
  }

  buf.buf = res[0];
  buf.md5 = md5;
};

Listener.prototype.save = function (id) {
  var self = this,
    buf = self.bufs[id];

  self.write(buf);
};

Listener.prototype.rename = function (old_path, new_path) {
  var self = this,
    buf = self.buf_by_path(old_path);

  delete self.paths_to_ids[old_path];
  self.paths_to_ids[new_path] = buf.id;
  buf.path = new_path;
  mkdirp.sync(path.dirname(new_path));
  /*eslint-disable no-sync */
  fs.renameSync(old_path, new_path);
  /*eslint-enable no-sync */
};

Listener.prototype.delete_buf = function (_path) {
  var self = this,
    buf = self.buf_by_path(_path),
    realpath = path.join(self.path, _path),
    dir = path.normalize(path.dirname(realpath));

  if (buf) {
    delete self.bufs[buf.id];
  }
  delete self.paths_to_ids[_path];

  fs.unlink(realpath, function (err) {
    if (err && err.code !== "ENOENT") {
      log.log("Tried to delete", realpath, "but I couldn't because", err);
    }

    while (dir && dir !== self.path && path.relative(self.path, dir).indexOf("..") === -1) {
      try {
        /*eslint-disable no-sync */
        fs.rmdirSync(dir);
        /*eslint-enable no-sync */
        log.log("Deleted empty directory", dir);
      } catch (e) {
        return log.debug("Couldn't delete", dir);
      }
      dir = path.normalize(path.dirname(dir));
    }
  });
};

Listener.prototype.write = function (buf, cb) {
  var self = this,
    realpath = path.join(self.path, buf.path);

  cb = cb || function (err) {
    if (err) {
      log.error(err);
    }
  };

  if (buf.path === ".floo") {
    self.hooks.expect_md5(buf.md5);
  }

  log.log("Writing", buf.path);
  try {
    /*eslint-disable no-sync */
    mkdirp.sync(path.dirname(realpath));
    fs.writeFileSync(realpath, buf.buf, {encoding: buf.encoding});
    /*eslint-enable no-sync */
  } catch (e) {
    return cb(e);
  }
  return cb();
};

module.exports = Listener;

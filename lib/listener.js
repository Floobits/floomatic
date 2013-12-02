var fs = require('fs');
var path = require('path');
var os = require('os');
var util = require('util');

var async = require('async');
var DMP;
var diff_match_patch = require('diff_match_patch');
var JS_DMP = new diff_match_patch.diff_match_patch();
var log = require("floorine");
var mkdirp = require("mkdirp");
var _ = require("lodash");

var ignores = require("./ignores");
var utils = require("./utils");


try {
  DMP = require("native-diff-match-patch");
} catch (e) {
  log.warn("No native-diff-match-patch. You won't be able to patch binary files.");
}

var fsevents;
if (process.platform === "darwin") {
  try {
    fsevents = require('fsevents');
  } catch (e) {
    log.warn('native fsevents can not be required.  This is not good');
  }
}


var Listener = function (_path, conn, hooks) {
  var self = this;

  self.path = _path;
  self.conn = conn;
  self.bufs = {};
  self.paths_to_ids = {};
  self.watchers = {};
  self.expected_changes = {};
  self.ignore_patterns = ["node_modules"];
  self.hooks = hooks;
};

Listener.prototype.buf_by_path = function (rel_path) {
  var self = this,
    buf_id = self.paths_to_ids[rel_path];

  return self.bufs[buf_id];
};

Listener.prototype.listener = function (parent_path, event, rel_to_parent_path) {
  var self = this,
    should_delete,
    abs_path = path.join(parent_path, rel_to_parent_path),
    buf_path = path.relative(self.path, abs_path),
    buf = self.buf_by_path(buf_path);

  log.log('%s was %s', event, buf_path);

  if (event === 'rename') {
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
    return self.create_buf(buf_path);
  }

  if (buf.buf === undefined) {
    return log.log('ignoring change');
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
    return self.node_watch_path(_path, ig);
  }
  if (!_.isEmpty(self.watchers)) {
    return log.debug('Already have a watcher, ignoring watch request for', _path);
  }
  self.osx_watch_path(_path, ig);

};

Listener.prototype.on_create = function (abs_path, buf) {
  var self = this,
    current,
    md5;

  log.log('created', abs_path);

  if (!buf) {
    self.create_buf(abs_path);
    return;
  }

  try {
    /*jslint stupid: true */
    current = fs.readFileSync(abs_path);
    /*jslint stupid: false */
  } catch (ignore) {
    self.on_delete(abs_path, buf);
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

  /*jslint stupid: true */
  current = fs.readFileSync(abs_path);
  /*jslint stupid: false */

  md5 = utils.md5(current);
  if (md5 === buf.md5) {
    return log.debug('got expected change');
  }

  log.log('new md5 is', md5);

  self.conn.send_patch(buf, current);
};

Listener.prototype.on_delete = function (abs_path, buf) {
  var self = this;

  if (!buf) {
    return;
  }
  log.debug("Deleted %s", abs_path);
  return self.conn.send_delete_buf(buf.id);
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

  watcher.on('created', function (abs_path) {
    self.on_create.apply(self, get_buf(abs_path));
  });

  watcher.on('deleted', function (abs_path) {
    self.on_delete.apply(self, get_buf(abs_path));
  });

  watcher.on('modified', function (abs_path) {
    self.on_change.apply(self, get_buf(abs_path));
  });

  watcher.on('moved-out', function (abs_path) {
    self.on_rename.apply(self, get_buf(abs_path));
  });

  watcher.on('moved-in', function (abs_path) {
    self.on_rename.apply(self, get_buf(abs_path));
  });

  self.watchers[_path] = watcher;
};

Listener.prototype.node_watch_path = function (_path, ig) {
  var self = this,
    paths,
    stats;

  /*jslint stupid: true */
  stats = fs.lstatSync(_path);
  /*jslint stupid: false */
  if (stats.isSymbolicLink()) {
    return log.error('Skipping adding %s because it is a symlink.', _path);
  }

  self.watchers[_path] = fs.watch(_path, self.listener.bind(self, _path));

  /*jslint stupid: true */
  paths = fs.readdirSync(_path);
  /*jslint stupid: false */

  _.each(paths, function (p) {
    var p_path = path.join(_path, p),
      ignored,
      child_ig;

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

  try {
    /*jslint stupid: true */
    stats = fs.lstatSync(_path);
    /*jslint stupid: false */
  } catch (e) {
    log.error(util.format('Error statting %s: %s', _path, e.toString()));
    return;
  }
  if (stats.isSymbolicLink()) {
    return log.error('Skipping adding %s because it is a symlink.', _path);
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
      /*jslint stupid: true */
      buf = fs.readFileSync(_path);
      /*jslint stupid: false */
    } catch (e2) {
      log.error(util.format('Error readFileSync %s: %s', _path, e2.toString()));
      return;
    }
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

  try {
    /*jslint stupid: true */
    paths = fs.readdirSync(_path);
    /*jslint stupid: false */
  } catch (e3) {
    log.error(util.format('Error readdiring %s: %s', _path, e3.toString()));
    return;
  }

  _.each(paths, function (p) {
    var p_path = path.join(_path, p),
      ignored,
      child_ig;

    if (p[0] === '.' && !_.contains(ignores.HIDDEN_WHITELIST, p)) {
      return log.log('Not creating buf for hidden path', p_path);
    }
    ignored = ig.is_ignored(p_path);
    if (ignored) {
      return log.log(util.format('Not adding %s because path is ignored.', p_path));
    }

    try {
      /*jslint stupid: true */
      stats = fs.lstatSync(p_path);
      /*jslint stupid: false */
    } catch (e) {
      log.error(util.format('Error lstatSync %s: %s', p_path, e.toString()));
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
    return self.conn.send_get_buf(id);
  }
  if (buf.buf === undefined) {
    return;
  }

  if (buf.encoding === "utf8") {
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
  } else if (DMP) {
    try {
      res = DMP.patch_apply(patch_text, buf.encoding === 'utf8' ? buf.buf.toString() : buf.buf);
    } catch (e) {
      log.error("Couldn't parse patch text:", patch_text, "\nException:", e);
      return self.conn.disconnect("Unable to parse the patch sent from the server.");
    }
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
    buf = self.buf_by_path(_path),
    realpath = path.join(self.path, _path),
    dir = path.normalize(path.dirname(realpath));

  if (buf) {
    delete self.bufs[buf.id];
  }
  delete self.paths_to_ids[_path];

  fs.unlink(realpath, function (err, result) {
    if (err) {
      return log.warn('Tried to delete', realpath, 'but I couldn\'t because', err, result);
    }
    log.log('Deleted', realpath);

    while (dir && dir !== self.path && path.relative(self.path, dir).indexOf('..') === -1) {
      try {
        /*jslint stupid: true */
        fs.rmdirSync(dir);
        /*jslint stupid: false */
        log.log("Deleted empty directory", dir);
      } catch (e) {
        return log.debug("Couldn't delete", dir);
      }
      dir = path.normalize(path.dirname(dir));
    }
  });
};

Listener.prototype.write = function (buf) {
  var self = this,
    realpath = path.join(self.path, buf.path);

  if (buf.path === ".floo") {
    self.hooks.expect_md5(buf.md5);
  }

  log.log("Writing", buf.path);

  mkdirp(path.dirname(realpath), function (err) {
    if (err) {
      log.warn(err);
    }
    fs.writeFile(realpath, buf.buf, {encoding: buf.encoding}, function (err) {
      if (err) {
        return log.error(err);
      }
    });
  });
};

module.exports = Listener;

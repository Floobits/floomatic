/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var util = require("util");

var _ = require("lodash");
var log = require("floorine");
var minimatch = require("minimatch");

var utils = require("./utils");


var IGNORE_FILES = ['.gitignore', '.hgignore', '.flignore', '.flooignore'],
  HIDDEN_WHITELIST = IGNORE_FILES.concat('.floo'),
  // gitconfig_file = popen("git config -z --get core.excludesfile", "r");
  DEFAULT_IGNORES = ['extern', 'node_modules', 'tmp', 'vendor'];


var create_flooignore = function (path) {
  var flooignore = path.join(path, '.flooignore');

  /*jslint stupid: true */
  if (fs.existsSync(flooignore)) {
    return;
  }
  fs.writeFileSync(flooignore, DEFAULT_IGNORES.join(os.EOL));
  /*jslint stupid: false */
};

function Ignore(parent, _path) {
  var self = this;

  self.ignores = {};
  self.parent = parent;

  self.path = path.normalize(_path);
  log.debug(util.format('Initializing ignores for %s', _path));
  _.each(IGNORE_FILES, self.load.bind(self));
}

Ignore.prototype.load = function (ignore_file) {
  var self = this,
    ignores;

  try {
    /*jslint stupid: true */
    ignores = fs.readFileSync(path.join(self.path, ignore_file), {encoding: "utf8"}).split(os.EOL);
    /*jslint stupid: false */
  } catch (e) {
    return;
  }

  self.ignores[ignore_file] = [];
  _.each(ignores, function (ignore) {
    ignore = ignore.trim();
    if (ignore.length === 0 || ignore[0] === "#") {
      return;
    }
    log.debug(util.format("Adding %s to ignore patterns", ignore));
    self.ignores[ignore_file].push(ignore);
  });
};

Ignore.prototype.is_ignored = function (_path) {
  var self = this,
    rel_path = path.relative(self.path, _path),
    i,
    j,
    ignore_file,
    patterns,
    base_path,
    file_name,
    ignored,
    keys = _.keys(self.ignores),
    pattern;

  for (i = 0; i < keys.length; i++) {
    ignore_file = keys[i];
    patterns = self.ignores[ignore_file];
    for (j = 0; j < patterns.length; j++) {
      ignored = false;
      pattern = patterns[j];
      base_path = path.dirname(rel_path);
      file_name = path.basename(rel_path);
      if (pattern[0] === '/') {
        if (path.normalize(base_path) === self.path && minimatch(file_name, pattern.slice(1))) {
          ignored = true;
        }
      } else if (minimatch(file_name, pattern) || minimatch(rel_path, pattern)) {
        ignored = true;
      }

      if (ignored) {
        log.log(util.format("%s ignored by pattern %s in %s", _path, pattern, path.join(self.path, ignore_file)));
        return true;
      }
    }
  }

  if (self.parent) {
    return self.parent.is_ignored(_path);
  }

  return false;
};


var build_ignores = function (_path, project_path) {
  var current_ignore = new Ignore(null, project_path),
    current_path = project_path,
    starting = path.relative(project_path, _path);

  _.each(starting.split(path.sep), function (p) {
    current_path = path.join(current_path, p);
    if (p === '..') {
      throw new Error(util.format("%s is not in project path %s", current_path, project_path));
    }
    current_ignore = new Ignore(current_ignore, current_path);
  });

  return current_ignore;
};


module.exports = {
  build_ignores: build_ignores,
  create_flooignore: create_flooignore,
  HIDDEN_WHITELIST: HIDDEN_WHITELIST,
  Ignore: Ignore
};

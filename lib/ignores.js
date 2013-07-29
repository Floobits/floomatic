var fs = require("fs");
var path = require("path");
var util = require("util");

var _ = require("lodash");
var minimatch = require("minimatch");

var log = require("./log");
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
  fs.writeFileSync(flooignore, DEFAULT_IGNORES.join('\n'));
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
    ignores = fs.readFileSync(path.join(self.path, ignore_file), {encoding: "utf8"}).split("\n");
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

Ignore.prototype.is_ignored_message = function (_path, pattern, ignore_file) {
  var self = this;
  return util.format("%s ignored by pattern %s in %s", _path, pattern, path.join(self.path, ignore_file));
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
    keys = _.keys(self.ignores),
    pattern;

  for (i = 0; i < keys.length; i++) {
    ignore_file = keys[i];
    patterns = self.ignores[ignore_file];
    for (j = 0; j < patterns.length; j++) {
      pattern = patterns[j];
      base_path = path.dirname(rel_path);
      file_name = path.basename(rel_path);
      if (pattern[0] === '/') {
        if (path.normalize(base_path) === self.path && minimatch(file_name, pattern.slice(1))) {
          return self.is_ignored_message(path, pattern, ignore_file);
        }
      } else {
        if (minimatch(file_name, pattern)) {
          return self.is_ignored_message(path, pattern, ignore_file);
        }
        if (minimatch(rel_path, pattern)) {
          return self.is_ignored_message(path, pattern, ignore_file);
        }
      }
    }
  }

  if (self.parent) {
    return self.parent.is_ignored(path);
  }

  return false;
};


var build_ignores = function (_path, project_path) {
  var current_ignore = new Ignore(null, project_path),
    current_path = project_path,
    starting = path.relative(project_path, path);

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
  create_flooignore: create_flooignore
};

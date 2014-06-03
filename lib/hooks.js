/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var util = require('util');

var log = require("floorine");
var minimatch = require('minimatch');
var _ = require("lodash");

var utils = require("./utils");


var Hooks = function (base_path) {
  var self = this;

  self.md5 = NaN;
  self.base_path = base_path;
  self.hooks = [];
  self.floo_path = path.join(self.base_path, '.floo');
  self.on_hooks_change(function () {
    try {
      self.watcher = fs.watchFile(self.floo_path, self.on_hooks_change.bind(self));
      log.log("Watching " + self.floo_path + " for changes");
    } catch (e) {
      log.warn(util.format("Can not watch %s for hooks because %s", self.floo_path, e));
    }
  });
};

Hooks.prototype.expect_md5 = function (md5) {
  var self = this;

  self.md5 = md5;
};

Hooks.prototype.load_hooks = function (floo) {
  var self = this,
    hooks = floo.hooks;

  self.hooks = [];

  if (!floo) {
    floo = utils.load_floo(self.base_path);
  }
  if (!hooks) {
    return log.log("Didn't find any hooks in .floo.");
  }

  _.each(hooks, function (hook, regex) {
    var callable, mm;

    if (!_.isString(regex)) {
      throw new Error('Hooks must be strings (for globbing)' + JSON.stringify(regex));
    }

    mm = new minimatch.Minimatch(regex, {
      dot: true,
      matchBase: true
    });

    callable = function (_path, cb) {
      var calling = hook.replace(/#FLOO_HOOK_FILE/g, _path);
      console.log('Calling', calling);
      exec(calling, function (error, stdout, stderr) {
        if (error) {
          log.error(error);
        }
        if (stderr) {
          log.error(stderr);
        }
        if (stdout) {
          log.log(stdout);
        }
        return cb();
      });
    };

    log.log('Installing hook:', regex, hook);
    self.hooks.push({mm: mm, hook: callable});
  });
};

Hooks.prototype.on_hooks_change = function (cb) {
  var self = this;

  if (!_.isFunction(cb)) {
    cb = function (err) {
      if (err) {
        log.error(err);
      }
    };
  }

  fs.readFile(self.floo_path, {encoding: 'utf8'}, function (err, file) {
    var floo,
      md5;

    if (err) {
      return log.warn(util.format("Can not load .floo file (%s) because %s.  No hooks will be run.", self.floo_path, err));
    }

    md5 = utils.md5(file);
    if (md5 === self.md5) {
      log.log("Ignoring our own change to the .floo file");
      return cb();
    }
    self.md5 = md5;

    log.log('Reloading hooks.');

    try {
      floo = JSON.parse(file);
    } catch (e) {
      floo = {};
    }

    self.load_hooks(floo);
    cb();
  });
};

Hooks.prototype.run_hooks = function (_path) {
  var self = this;

  _.each(self.hooks, function (hook) {
    if (hook.mm.match(_path) && !hook.is_running) {
      hook.is_running = true;
      hook.hook.call(null, _path, function () {
        hook.is_running = false;
      });
    }
  });
};

Hooks.prototype.on_saved = function (_path) {
  var self = this;

  if (_path !== ".floo") {
    self.run_hooks(_path);
    return;
  }
  self.md5 = NaN;
  self.on_hooks_change(self.run_hooks.bind(self, _path));
};

module.exports = Hooks;

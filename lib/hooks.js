var exec = require('child_process').exec;
var fs = require('fs');

var minimatch = require('minimatch');
var _ = require("lodash");

var log = require("./log");
var utils = require("./utils");


var Hooks = function (hook_path) {
  var self = this;

  self.hook_path = hook_path;
  self.hooks = [];
  self.load_hooks(hook_path);
  self.watcher = fs.watchFile(hook_path, self.on_hooks_change.bind(self));
};

Hooks.prototype.load_hooks = function () {
  var self = this,
    floo = utils.load_floo(self.hook_path),
    hooks = floo.hooks;

  if (!hooks) {
    return log.log("Didn't find any hooks in .floo.");
  }

  _.each(hooks, function (hook, regex) {
    var callable;

    if (!_.isString(regex)) {
      throw new Error('Hooks must be strings (for globbing)' + JSON.stringify(regex));
    }

    regex = minimatch.makeRe(regex, {
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
    self.hooks.push({re: regex, hook: callable});
  });
};

Hooks.prototype.on_hooks_change = function (prev, current) {
  var self = this;

  log.log('Reloading hooks.');
  self.load_hooks();
};

Hooks.prototype.on_saved = function (_path) {
  var self = this;

  _.each(self.hooks, function (hook) {
    var match = _path.match(hook.re);

    if (match && !hook.is_active) {
      hook.is_active = true;
      hook.hook.call(null, _path, function () {
        hook.is_active = false;
      });
    }
  });
};

module.exports = Hooks;

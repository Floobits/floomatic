var exec = require('child_process').exec;

var minimatch = require('minimatch');
var _ = require("lodash");

var log = require("./log");
var utils = require("./utils");


var Hooks = function (hook_path) {
  var self = this,
    callable,
    floo = utils.load_floo(hook_path),
    hooks = floo.hooks;

  self.hooks = [];

  if (!hooks) {
    return log.log("Didn't find any hooks in .floo.");
  }

  _.each(hooks, function (hook, regex) {
    if (_.isString(regex)) {
      regex = minimatch.makeRe(regex, {
        dot: true,
        matchBase: true
      });
    }
    if (!_.isRegExp(regex)) {
      throw new Error('regex must be a string or regex' + JSON.stringify(regex));
    }

    if (_.isString(hook)) {
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
    } else {
      callable = hook;
    }

    if (!_.isFunction(callable)) {
      throw new Error('Hooks must be functions or strings: ' + JSON.stringify(callable));
    }
    log.log('Installing hook:', regex);
    self.hooks.push({re: regex, hook: callable});
  });
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

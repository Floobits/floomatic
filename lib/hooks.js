var exec = require('child_process').exec;

var minimatch = require('minimatch');
var _ = require("underscore");

var log = require("./log");


var Hooks = function (hooks_path) {
  var self = this,
    callable,
    hooks = {};

  self.hooks = [];

  if (hooks_path) {
    hooks = require(hooks_path);
  }

  _.each(hooks, function (hook, regex) {
    if (_.isString(regex)) {
      regex = minimatch.makeRe(regex);
    }
    if (!_.isRegExp(regex)) {
      throw new Error('regex must be a string or regex' + JSON.stringify(regex));
    }

    if (_.isString(hook)) {
      callable = function (_path, cb) {
        var calling = hook + ' ' + _path;
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
      throw new Error('hooks must be functions or strings' + JSON.stringify(callable));
    }
    log.log('Installing hook:', regex);
    self.hooks.push({re: regex, hook: callable});
  });
};

Hooks.prototype.match = function () {

};

// Hooks.prototype.on_write = function (filename, buffer) {
//   var self = this;

//   _.each(self.hooks, function (hook) {
//     var match = filename.match(hook.re);

//     if (match) {
//       hook.hook.call(null, filename, buffer);
//     } else {
//       log.log(filename, "doesn't match", hook.re);
//     }
//   });
// };

Hooks.prototype.on_saved = function (req) {
  _.each(self.hooks, function (hook) {
    var match = filename.match(hook.re);

    if (match && !hook.is_active) {
      hook.is_active = true;
      hook.hook.call(null, filename, function() {
        hook.is_active = false;
      });
    }
  });
};

// > filename.match(minimatch.makeRe('*.py'))
// [ 'asdf.py' ]
// > filename.match(regex)

module.exports = Hooks;

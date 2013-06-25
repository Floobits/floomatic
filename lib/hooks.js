var exec = require('child_process').exec;

var minimatch = require('minimatch');

var hooks = function(raw_hooks) {
  var self = this;

  _.each(raw_hooks, function(hook, regex) {
    if (_.isString(regex)) {
      regex = new minimatch.makeRe(regex);
    }
    if (!_.isRegExp(regex)) {
      throw new Error('regexs must be strings or regexs' + JSON.stringify(regex));
    }

    if (_.isString(hook)) {
      hook = exec.bind(null, hook, function(error, stdout, stderr) {
        if (error) log.error(error);
        if (stderr) log.error(stderr);
        if (stdout) log.log(stdout);
      });
    }
    if (!_.isFunction(hook)) {
      throw new Error('hooks must be functions or strings' + JSON.stringify(hook));
    }
    hooks[regex] = hook;
  });
};

hooks.prototype.call = function(_path, buf) {
  _.each(self.hooks, function(hook, regex) {
    var matches = _path.match(regex);

    if (matches){
      hook(_path, buf, matches);
    }
  });
};
exports.hooks = hooks;
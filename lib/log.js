var _ = require("lodash");

/*jslint regexp: true */
var function_name_regex = /\s*(function[^\(\)]*\([^\(\)]*\))/;
/*jslint regexp: false */

var log_levels = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3
};

var log_levels_to_string = {};

var log_levels_to_color = {
  0: "\x1b[31;1m",
  1: "\x1b[33;1m",
  2: "\x1b[32;1m",
  3: "\x1b[34;1m"
};

var log_levels_to_func = {
  error: console.error,
  warn: console.warn,
  log: console.log,
  debug: console.log
};

_.each(log_levels, function (value, key) {
  log_levels_to_string[value] = "__" + key.toUpperCase() + "__";
});

var log_level = "log";

var set_log_level = function (new_log_level) {
  if (log_levels[new_log_level] === undefined) {
    console.error(new_log_level, "is not a valid log level");
    process.exit(1);
  } else {
    log_level = log_levels[new_log_level];
  }
};

var log = function (level_name, args, caller) {
  var now = new Date(),
    log_fn,
    level = log_levels[level_name];

  args = Array.prototype.slice.call(args);
  if (args.length === 0) {
    args.push(caller, "called log with no message");
    level = log_levels.error;
  }

  if (log_levels_to_func[level_name] === undefined) {
    console.error("Invalid log level:", level);
    return;
  }

  if (level <= log_level) {
    args.unshift(log_levels_to_color[level], log_levels_to_string[level], "\x1b[0m", "\x1b[40;1;30m", now, "\x1b[0m");
    log_levels_to_func[level_name].apply(null, args);
    if (level === log_levels.error &&
        args[0] !== undefined &&
        args[0].stack !== undefined) {
      console.error(args[0].stack);
    }
  }
};

_.each(log_levels, function (value, key) {
  exports[key] = function f() {
    var caller = f.caller.toString().match(function_name_regex);
    caller = caller === undefined ? caller : caller[0];
    log(key, arguments, caller);
  };
});

exports.set_log_level = set_log_level;

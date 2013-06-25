var async = require("async");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");


var md5 = function (buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
};

var patched_cleanly = function (result) {
  var clean_patch = true,
    i = 0;

  for (i; i < result[1].length; i++) {
    if (result[1][i] !== true) {
      clean_patch = false;
      break;
    }
  }
  return clean_patch;
};

var walk_dir = function (p, cb) {
  var paths = {
    files: [],
    dirs: []
  };

  fs.lstat(p, function (err, st) {
    if (err) {
      if (err.errno === 34) {
        return cb(null, paths);
      }
      return cb(err, paths);
    }
    // Ignore hidden files. Yeah I know this is lame and you can put hidden files in a repo/room.
    if (path.basename(p)[0] === ".") {
      return cb(null, paths);
    }
    if (!st.isDirectory()) {
      paths.files.push(p);
      return cb(null, paths);
    }
    paths.dirs.push(p);
    return fs.readdir(p, function (err, filenames) {
      async.each(filenames, function (file, callback) {
        var abs_path = path.join(p, file);
        walk_dir(abs_path, function (err, sub_paths) {
          paths.dirs = paths.dirs.concat(sub_paths.dirs);
          paths.files = paths.files.concat(sub_paths.files);
          callback(err);
        });
      },
        function (err, result) {
          cb(err, paths);
        });
    });
  });
};

module.exports = {
  md5: md5,
  patched_cleanly: patched_cleanly,
  walk_dir: walk_dir
};

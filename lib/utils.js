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

var is_binary = function (bytes, size) {
  var i,
    max_bytes = 512,
    suspicious_bytes = 0,
    total_bytes;

  if (size === 0) {
    return false;
  }

  total_bytes = Math.min(size, max_bytes);

  if (size >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    // UTF-8 BOM. This isn't binary.
    return false;
  }
  /*jslint continue: true */
  for (i = 0; i < total_bytes; i++) {
    if (bytes[i] === 0) { // NULL byte--it's binary!
      return true;
    }
    if ((bytes[i] < 7 || bytes[i] > 14) && (bytes[i] < 32 || bytes[i] > 127)) {
      // UTF-8 detection
      if (bytes[i] > 191 && bytes[i] < 224 && i + 1 < total_bytes) {
        i++;
        if (bytes[i] < 192) {
          continue;
        }
      } else if (bytes[i] > 223 && bytes[i] < 239 && i + 2 < total_bytes) {
        i++;
        if (bytes[i] < 192 && bytes[i + 1] < 192) {
          i++;
          continue;
        }
      }
      suspicious_bytes++;
      // Read at least 32 bytes before making a decision
      if (i > 32 && (suspicious_bytes * 100) / total_bytes > 10) {
        return true;
      }
    }
  }
  /*jslint continue: false */
  if ((suspicious_bytes * 100) / total_bytes > 10) {
    return true;
  }

  return false;
};

module.exports = {
  is_binary: is_binary,
  md5: md5,
  patched_cleanly: patched_cleanly,
  walk_dir: walk_dir
};

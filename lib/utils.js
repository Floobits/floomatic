"use strict";

var crypto = require("crypto");
var fs = require("fs");
var net = require("net");
var path = require("path");
var tls = require("tls");
var url = require("url");
var util = require("util");

var log = require("floorine");

var parse_url = function (workspace_url) {
  var parsed_url,
    res,
    p,
    exit = function () {
      log.error("The workspace must be a valid url:", workspace_url);
      /*eslint-disable no-process-exit */
      process.exit(1);
      /*eslint-enable no-process-exit */
    };

  try {
    parsed_url = url.parse(workspace_url);
  } catch (e) {
    return exit();
  }
  p = parsed_url.path;
  res = p.match(/\/r\/([\-\@\+\.\w]+)\/([\-\@\+\.\w]+)/) || p.match(/\/([\-\@\+\.\w]+)\/([\-\@\+\.\w]+)/);

  if (!res) {
    return exit();
  }

  return {
    host: parsed_url.hostname,
    port: parsed_url.protocol === "http" ? 3148 : 3448,
    klass: parsed_url.protocol === "http" ? net : tls,
    owner: res[1],
    secure: parsed_url.protocol === "https",
    workspace: res[2]
  };
};

var to_browser_url = function (secure, hostname, owner, workspace_name) {
  var protocol = secure ? "https" : "http";
  return util.format("%s://%s/%s/%s", protocol, hostname, owner, workspace_name);
};

var parse_floorc = function () {
  var floorc = {},
    floorc_path;

  try {
    floorc_path = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"], ".floorc.json");

    /*eslint-disable no-sync */
    floorc = JSON.parse(fs.readFileSync(floorc_path, "utf-8"));
    /*eslint-enable no-sync */
  } catch (e) {
    log.error("No valid ~/.floorc.json file was found.");
    return null;
  }
  return floorc;
};

var load_floo = function (_path) {
  var floo_file, data = {};

  if (_path) {
    _path = path.join(_path, ".floo");
  } else {
    _path = ".floo";
  }

  try {
    /*eslint-disable no-sync */
    floo_file = fs.readFileSync(_path);
    /*eslint-enable no-sync */
  } catch (ignore) {
    log.log("Workspace info file (%s) not found.", _path);
    return {};
  }
  try {
    data = JSON.parse(floo_file);
  } catch (e) {
    log.warn("Error parsing %s: %s", floo_file, e);
  }
  return data;
};

var parse_dot_floo = function () {
  var parsed_url = {},
    data = load_floo();

  parsed_url = data.url ? parse_url(data.url) : {};

  return parsed_url;
};

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
  load_floo: load_floo,
  md5: md5,
  parse_dot_floo: parse_dot_floo,
  parse_floorc: parse_floorc,
  parse_url: parse_url,
  patched_cleanly: patched_cleanly,
  to_browser_url: to_browser_url
};

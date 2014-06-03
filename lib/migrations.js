/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var fs = require("fs");
var path = require("path");
var util = require("util");

var log = require("floorine");
var _ = require("lodash");

var floorc = function () {
  var floorc = {
      "auth": {
        "floobits.com": {}
      }
    },
    floorc_path,
    floorc_lines;

  floorc_path = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"], ".floorc");
  /*jslint stupid: true */
  floorc_lines = fs.readFileSync(floorc_path, "utf-8").split(/\n|\r\n/g);
  /*jslint stupid: false */
  _.each(floorc_lines, function (line) {
    var match,
      key,
      value;
    /*jslint regexp: true */
    if (line.match(/^\s*#.*/)) {
      return;
    }
    match = line.match(/(\S+)\s+(\S+)/);
    /*jslint regexp: false */
    if (!match) {
      return;
    }
    key = match[1].trim().toLowerCase();
    value = match[2].trim();
    if (!key || !value) {
      return;
    }
    if (_.contains(["username", "secret", "api_key"], key)) {
      floorc.auth["floobits.com"][key] = value;
    } else {
      floorc[key] = value;
    }
    log.debug("%s = %s", key, value);
  });

  /*jslint stupid: true */
  fs.writeFileSync(util.format("%s.json", floorc_path), JSON.stringify(floorc), "utf-8");
  /*jslint stupid: false */

  return floorc;
};

module.exports = {
  floorc: floorc
};

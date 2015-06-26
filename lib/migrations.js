"use strict";

var fs = require("fs");
var path = require("path");
var util = require("util");

var log = require("floorine");
var _ = require("lodash");

function migrate_floorc () {
  var floorc = {
      "auth": {
        "floobits.com": {}
      }
    },
    floorc_path,
    floorc_lines;

  floorc_path = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"], ".floorc");
  /*eslint-disable no-sync */
  floorc_lines = fs.readFileSync(floorc_path, "utf-8").split(/\n|\r\n/g);
  /*eslint-enable no-sync */
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

  /*eslint-disable no-sync */
  fs.writeFileSync(util.format("%s.json", floorc_path), JSON.stringify(floorc), "utf-8");
  /*eslint-enable no-sync */

  return floorc;
}

module.exports = {
  floorc: migrate_floorc
};

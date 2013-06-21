#!/usr/bin/env node
var fs = require('fs');
var tls = require('tls');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var _ = require("underscore");

var floo_connection = require("./lib/floo_connection");
var listener = require("./lib/listener");


var parse_url = function (url, cb) {
  var parsed_url = {};

  parsed_url.host = "floobits.com";
  parsed_url.port = 3448;
  parsed_url.klass = tls;
  parsed_url.room = "rax-demo";
  parsed_url.owner = "kansface";

  // parsed_url.conn_class = net;

  return parsed_url;
};


exports.run = function () {
  var cwd = process.cwd(),
    floo_conn,
    floo_listener,
    floorc = {},
    floorc_path,
    floorc_lines,
    floo_file,
    data,
    parsed_url;

  try {
    floorc_path = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"], ".floorc");
    floorc_lines = fs.readFileSync(floorc_path, "utf-8").split("\n");
    _.each(floorc_lines, function (line) {
      var space,
        key,
        value;
      if (line.match(/^\s*#.*/)) {
        return;
      }
      space = line.indexOf(" ");
      key = line.slice(0, space).toLowerCase();
      value = line.slice(space + 1);
      floorc[key] = value;
    });
  } catch (e) {
    console.error("no ~/.floorc file", e);
    process.exit(1);
  }

  try {
    floo_file = fs.readFileSync(".floo");
    data = JSON.parse(floo_file);
    parsed_url = parse_url(data.url);
  } catch (e) {
    console.log("no .floo file in current directory");
  }


  floo_conn = new floo_connection.FlooConnection(parsed_url);
  console.log('watching cwd', process.cwd());
  floo_listener = new listener.Listener(process.cwd(), floo_conn);
  floo_conn.connect(floorc.username, floorc.secret);
};

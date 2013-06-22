#!/usr/bin/env node
var fs = require('fs');
var tls = require('tls');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var optimist = require('optimist');
var _ = require("underscore");

var floo_connection = require("./lib/floo_connection");
var listener = require("./lib/listener");


var parse_url = function (url, cb) {
  var parsed_url = {};

  parsed_url.host = "floobits.com";
  parsed_url.port = 3448;
  parsed_url.klass = tls;
  parsed_url.workspace = "rax-demo";
  parsed_url.owner = "kansface";

  // parsed_url.conn_class = net;

  return parsed_url;
};

var parse_floorc = function(){
  var floorc = {},
    floorc_path,
    floorc_lines;

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
  }
  return floorc;
};

var parse_dot_floo = function(){
  var parsed_url = {};
  try {
    floo_file = fs.readFileSync(".floo");
    data = JSON.parse(floo_file);
    parsed_url = parse_url(data.url);
  } catch (e) {
    console.log("no .floo file in current directory");
  }
  return parsed_url;
};

var parse_args = function(){
  var floorc = parse_floorc();
  var parsed_url = parse_dot_floo();

  return optimist
    .usage('Usage: $0 -o [owner] -w [workspace] -u [username] -s [secret] -H [host] -p [port] --create-room --delete-room')
    .default('H', parsed_url.host || 'floobits.com')
    .default('p', 3448)
    .default('u', floorc.username)
    .default('s', floorc.secret)
    .default('w', parsed_url.workspace)
    .default('o', parsed_url.owner || floorc.username)
    .demand(['H', 'p', 'o', 'w', 'u', 's'])
    .argv;
};

exports.run = function () {
  var cwd = process.cwd(),
    floo_conn,
    floo_listener,
    floorc,
    floo_file,
    data,
    parsed_url,
    args = parse_args();

  floo_conn = new floo_connection.FlooConnection(args.H, args.p, args.o, args.w, args.u, args.s);
  console.log('watching cwd', process.cwd());
  floo_listener = new listener.Listener(process.cwd(), floo_conn);
  floo_conn.connect();
};

#!/usr/bin/env node
var fs = require("fs");
var net = require("net");
var tls = require("tls");
var path = require("path");
var url = require("url");
var util = require("util");

var async = require("async");
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var open_url = require("open");
var optimist = require("optimist");
var _ = require("lodash");

var lib = require("./lib");
var log = lib.log;
var api = lib.api;

log.set_log_level("log");

var parse_url = function (workspace_url) {
  var parsed_url,
    re = /\/r\/([\-\@\+\.\w]+)\/([\-\w]+)/,
    res;

  parsed_url = url.parse(workspace_url);
  res = parsed_url.path.match(re);

  return {
    host: parsed_url.hostname,
    port: parsed_url.protocol === "http" ? 3148 : 3448,
    klass: parsed_url.protocol === "http" ? net : tls,
    owner: res && res[1],
    secure: parsed_url.protocol === "https",
    workspace: res && res[2]
  };
};

var to_browser_url = function (secure, hostname, owner, workspace_name) {
  var protocol = secure ? "https" : "http";
  return util.format("%s://%s/r/%s/%s/", protocol, hostname, owner, workspace_name);
};

var parse_floorc = function () {
  var floorc = {},
    floorc_path,
    floorc_lines;

  try {
    floorc_path = path.join(process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"], ".floorc");
    /*jslint stupid: true */
    floorc_lines = fs.readFileSync(floorc_path, "utf-8").split("\n");
    /*jslint stupid: false */
    _.each(floorc_lines, function (line) {
      var space,
        key,
        value;
      /*jslint regexp: true */
      if (line.match(/^\s*#.*/)) {
        return;
      }
      /*jslint regexp: false */
      space = line.indexOf(" ");
      key = line.slice(0, space).toLowerCase();
      value = line.slice(space + 1);
      floorc[key] = value;
    });
  } catch (e) {
    log.error("no ~/.floorc file was found");
  }
  return floorc;
};

var parse_dot_floo = function () {
  var data,
    floo_file,
    parsed_url = {};
  try {
    /*jslint stupid: true */
    floo_file = fs.readFileSync(".floo");
    /*jslint stupid: false */
    data = JSON.parse(floo_file);
    parsed_url = parse_url(data.url);
  } catch (e) {
    log.log("no .floo file in current directory");
  }
  return parsed_url;
};

var parse_args = function () {
  var floorc = parse_floorc(),
    parsed_url = parse_dot_floo();

  return optimist
    .usage('Usage: $0 -o [owner] -w [workspace] -u [username] -s [secret] --url [url] --create [name] --delete --read-only --send-local --hooks [path_to_hooks] --verbose')
    .default('H', parsed_url.host || 'floobits.com')
    .default('p', 3448)
    .describe('u', 'Your Floobits username. Defaults to your ~/.floorc defined username.')
    .default('u', floorc.username)
    .describe('s', 'Your Floobits secret. Defaults to your ~/.floorc defined secret.')
    .default('s', floorc.secret)
    .describe('w', 'The Floobits Workspace')
    .default('w', parsed_url.workspace)
    .describe('o', 'The owner of the Workspace. Defaults to the .floo file\'s owner or your ~/.floorc username.')
    .default('o', parsed_url.owner || floorc.username)
    .describe('create', 'Creates a new workspace if possible (any value passed will override -w) If not -w, defaults to the dirname.')
    .describe('delete', 'Deletes the workspace if possible (can be used with --create to overwrite an existing workspace).')
    .describe('H', 'Host to connect to. For debugging/development. Defaults to floobits.com.')
    .describe('p', 'Port to use. For debugging/development. Defaults to 3448.')
    .describe('send-local', "Overwrites the workspace's files with your local files on startup.")
    .describe('hooks', "Hooks to run after stuff is changed.  Must be a node require-able file")
    .describe('read-only', 'Will not send patches for local modifications (Always enabled for OS X).')
    .demand(['H', 'p', 'u', 's'])
    .argv;
};

exports.run = function () {
  var cwd = process.cwd(),
    floorc,
    floo_file,
    data,
    parsed_url,
    series = [function (cb) { cb(); }],
    raw_hooks = {},
    args = parse_args();

  if (args.verbose) {
    log.set_log_level("debug");
  }

  if (args.help || args.h) {
    optimist.showHelp();
    process.exit(0);
  }

  args.o = args.o || args.u;
  if (args.create && args.create === true) {
    args.create = path.basename(process.cwd());
  }
  args.w = args.create || args.w;

  if (args.url) {
    parsed_url = parse_url(args.url);
    args.w = args.w || parsed_url.workspace;
    args.o = args.o || parsed_url.owner;
  }

  if (!args.w) {
    optimist.showHelp();
    log.error('I need a workspace name.');
    process.exit(0);
  }

  if (args['delete']) {
    series.push(api.del.bind(api, args.H, args.u, args.o, args.s, args.w));
  }

  if (args.create) {
    series.push(api.create.bind(api, args.H, args.u, args.o, args.s, args.w, args.perms));
  }

  if (!args['read-only']) {
    series.push(open_url.bind(null, to_browser_url(args.p === 3448, args.H, args.o, args.w)));
  }

  async.series(series, function (err) {
    var floo_conn;

    if (err) {
      return log.error(err);
    }
    floo_conn = new lib.FlooConnection(args);
    floo_conn.connect();
  });
};

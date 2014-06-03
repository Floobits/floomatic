#!/usr/bin/env node
/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");

var mkdirp = require('mkdirp');
var async = require("async");
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var log = require("floorine");
var open_url = require("open");
var optimist = require("optimist");
var _ = require("lodash");

var lib = require("./lib");
var api = lib.api;
var utils = lib.utils;

log.set_log_level("log");


var parse_args = function (floorc) {
  var parsed_floo = utils.parse_dot_floo();

  return optimist
    .usage('Usage: $0 --join [url] --share --read-only --verbose [path_to_sync]')
    .default('H', parsed_floo.host || floorc.default_host || 'floobits.com')
    .default('p', 3448)
    .describe('join', "The URL of the workspace to join (cannot be used with --share).")
    .describe('share', 'Creates a new workspace if possible. Otherwise, it will sync local files to the existing workspace.')
    .boolean('share')
    .describe('w', 'The Floobits Workspace.')
    .default('w', parsed_floo.workspace)
    .describe('o', 'The owner of the Workspace. Defaults to the .floo file\'s owner or your ~/.floorc username.')
    .default('o', parsed_floo.owner || floorc.username)
    .describe('read-only', 'Will not send patches for local modifications (Always enabled for OS X).')
    .describe('H', 'Host to connect to. For debugging/development. Defaults to floobits.com.')
    .describe('p', 'Port to use. For debugging/development. Defaults to 3448.')
    .describe('verbose', 'Enable debugging output.')
    .describe('no-browser', "Don't try to open the web editor (--read-only mode also enables this)")
    .demand(['H', 'p'])
    .argv;
};

exports.run = function () {
  var cwd = process.cwd(),
    floorc = utils.parse_floorc(),
    parsed_url,
    series = [function (cb) { cb(); }],
    args = parse_args(floorc),
    _path;

  if (args._.length === 0) {
    _path = cwd;
  } else if (args._.length === 1) {
    _path = args._[0];
  } else {
    throw new Error("Invalid arguments. Only one path is allowed.");
  }
  _path = path.resolve(_path);
  _path = path.normalize(_path);

  if (args.verbose) {
    log.set_log_level("debug");
  }

  if (args.help || args.h) {
    optimist.showHelp();
    process.exit(0);
  }

  args.o = args.o || floorc.username;
  if (args.share && args.share === true) {
    args.share = _path;
  }
  args.w = _.compose(path.normalize, path.basename)(args.w || args.share);

  if (args.join) {
    parsed_url = utils.parse_url(args.join);
    args.w = parsed_url.workspace;
    args.o = parsed_url.owner;
  }

  if (!args.w) {
    optimist.showHelp();
    log.error('I need a workspace name.');
    process.exit(0);
  }

  if (args.share) {
    series.push(api.create.bind(api, args.H, floorc.username, args.o, floorc.secret, args.w, args.perms));
  }

  async.series(series, function (err) {
    var floo_conn,
      workspace_url = utils.to_browser_url(args.p === 3448, args.H, args.o, args.w);

    if (err) {
      return log.error(err);
    }

    mkdirp.sync(_path);
    floo_conn = new lib.FlooConnection(_path, floorc, args);

    if (!args['read-only'] && !args['no-browser']) {
      floo_conn.once('room_info', function () {
        log.log("Opening browser to %s", workspace_url);
        open_url(workspace_url);
      });
    }
    log.log("Joining workspace %s", workspace_url);
    floo_conn.connect();
  });
};

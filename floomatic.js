#!/usr/bin/env node
/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true */
"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");
var util = require("util");

var mkdirp = require("mkdirp");
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
var package_json = require("./package.json");

log.set_log_level("log");


var parse_args = function (floorc) {
  var parsed_floo = utils.parse_dot_floo(),
    default_host = floorc.default_host || "floobits.com",
    username;

  username = floorc.auth[default_host].username;

  return optimist
    .usage("Usage: $0 --join [url] --share [url] --read-only --verbose [path_to_sync]")
    .default("H", parsed_floo.host || default_host)
    .default("p", 3448)
    .describe("join", "The URL of the workspace to join (cannot be used with --share).")
    .default("share", false)
    .describe("share", "Creates a new workspace if possible. Otherwise, it will sync local files to the existing workspace.")
    .describe("w", "The Floobits Workspace.")
    .default("w", parsed_floo.workspace)
    .describe("o", "The owner of the Workspace. Defaults to the .floo file's owner or your ~/.floorc username.")
    .default("o", parsed_floo.owner || username)
    .describe("read-only", "Don't send patches for local modifications.")
    .describe("H", "Host to connect to. For debugging/development. Defaults to floobits.com.")
    .describe("p", "Port to use. For debugging/development. Defaults to 3448.")
    .describe("verbose", "Enable debugging output.")
    .describe("version", "Print version.")
    .describe("no-browser", "Don't try to open the web editor (--read-only mode also enables this)")
    .demand(["H", "p"])
    .argv;
};

var print_version = function () {
  console.log(util.format("%s version %s", package_json.name, package_json.version));
};

exports.run = function () {
  var cwd = process.cwd(),
    floorc = utils.parse_floorc(),
    parsed_url,
    series = [function (cb) { cb(); }],
    args = parse_args(floorc),
    _path,
    username,
    secret;

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
    print_version();
    optimist.showHelp();
    process.exit(0);
  }

  if (args.version) {
    print_version();
    process.exit(0);
  }

  if (args.share && args.share === true) {
    args.share = _path;
  }
  args.w = _.compose(path.normalize, path.basename)(args.w || args.share);

  if (args.join && args.share) {
    log.error("You can't share and join at the same time!");
    process.exit(1);
  }
  if (args.join || args.share) {
    parsed_url = utils.parse_url(args.join || args.share);
    args.w = parsed_url.workspace;
    args.o = parsed_url.owner;
    args.H = parsed_url.host;
  }

  if (!args.w) {
    optimist.showHelp();
    log.error("I need a workspace name.");
    process.exit(0);
  }

  if (args.share) {
    try {
      username = floorc.auth[args.H].username;
      secret = floorc.auth[args.H].secret;
    } catch (e) {
      log.error("No auth found in ~/.floorc.json for %s", args.H);
      process.exit(1);
    }
    series.push(function (cb) {
      api.create(args.H, username, args.o, secret, args.w, args.perms, function (err) {
        if (err && err.statusCode !== 403) {
          return cb(err);
        }
        return cb();
      });
    });
  } else if (!args.join) {
    series.push(function (cb) {
      log.log("Only syncing changes made after startup. Use --share to upload existing local files.");
      return cb();
    });
  }

  async.series(series, function (err) {
    var floo_conn,
      workspace_url = utils.to_browser_url(args.p === 3448, args.H, args.o, args.w);

    if (err) {
      return log.error(err);
    }

    mkdirp.sync(_path);
    try {
      floo_conn = new lib.FlooConnection(_path, floorc, args);
    } catch (e) {
      log.error(e);
      process.exit(1);
    }

    floo_conn.once("room_info", function () {
      if (args["read-only"]) {
        log.log("Not opening browser because you don't have permission to write to this workspace.");
        return;
      }
      if (args["no-browser"]) {
        log.log("Not opening browser because you specified --no-browser.");
        return;
      }
      log.log("Opening browser to %s", workspace_url);
      open_url(workspace_url);
    });
    log.log("Joining workspace %s", workspace_url);
    floo_conn.connect();
  });
};

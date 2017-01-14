#!/usr/bin/env node
"use strict";

var path = require("path");
var util = require("util");

var mkdirp = require("mkdirp");
var async = require("async");
var log = require("floorine");
var open_url = require("open");
var optimist = require("optimist");
var _ = require("lodash");

var lib = require("./lib");
var api = lib.api;
var utils = lib.utils;
var package_json = require("./package.json");

log.set_log_level("log");


function parse_args (floorc) {
  const parsed_floo = utils.parse_dot_floo();
  const default_host = floorc.default_host || "floobits.com";

  const username = floorc.auth[default_host].username;
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
}

function print_version () {
  console.log(util.format("%s version %s", package_json.name, package_json.version));
}

exports.run = function () {
  const floorc = utils.parse_floorc();
  if (!floorc) {
    process.exit(1);
  }
  let _path;
  const args = parse_args(floorc);
  if (args._.length === 0) {
    if (args.share && args.share !== true) {
      _path = args.share;
    } else {
      _path = process.cwd();
    }
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
    /*eslint-disable no-process-exit */
    process.exit(0);
    /*eslint-enable no-process-exit */
  }

  if (args.version) {
    print_version();
    /*eslint-disable no-process-exit */
    process.exit(0);
    /*eslint-enable no-process-exit */
  }

  if (args.share && args.share === true) {
    args.share = _path;
  }

  if (args.join && args.share) {
    log.error("You can't share and join at the same time!");
    /*eslint-disable no-process-exit */
    process.exit(1);
    /*eslint-enable no-process-exit */
  }
  let parsed_url;
  if (args.join) {
    parsed_url = utils.parse_url(args.join);
    args.w = parsed_url.workspace;
    args.o = parsed_url.owner;
    args.H = parsed_url.host;
    if(!args.H) {
      optimist.showHelp();
      log.error("Floomatic couldn't find a host, did you provide a valid URL?");
      process.exit(1);
    }
  } else if (args.w || args.share) {
    args.w = _.flowRight(path.normalize, path.basename)(args.w || args.share);
  }

  if (!args.w || !args.o) {
    optimist.showHelp();
    log.error("Floomatic needs a workspace name and the name of the user org that owns it.");
    /*eslint-disable no-process-exit */
    process.exit(1);
    /*eslint-enable no-process-exit */
  }
  let username;
  let secret;
  let series = [function (cb) { cb(); }];
  if (args.share) {
    try {
      username = floorc.auth[args.H].username;
      secret = floorc.auth[args.H].secret;
    } catch (e) {
      log.error("No auth found in ~/.floorc.json for %s", args.H);
      /*eslint-disable no-process-exit */
      process.exit(1);
      /*eslint-enable no-process-exit */
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
    if (err) {
      return log.error(err);
    }

    mkdirp.sync(_path);
    let floo_conn;
    try {
      floo_conn = new lib.FlooConnection(_path, floorc, args);
    } catch (e) {
      log.error(e);
      /*eslint-disable no-process-exit */
      process.exit(1);
      /*eslint-enable no-process-exit */
    }

    const workspace_url = utils.to_browser_url(args.p === 3448, args.H, args.o, args.w);
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

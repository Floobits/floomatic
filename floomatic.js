#!/usr/bin/env node

var fs = require("fs");
var net = require("net");
var tls = require("tls");
var path = require("path");
var url = require("url");
var util = require("util");
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

log.set_log_level("log");

var parse_url = function (workspace_url) {
  var parsed_url,
    res,
    path,
    exit = function () {
      log.error('The workspace must be a valid url:', workspace_url);
      process.exit(1);
    };

  try {
    parsed_url = url.parse(workspace_url);
  } catch (e) {
    return exit();
  }
  path = parsed_url.path;
  res = path.match(/\/r\/([\-\@\+\.\w]+)\/([\-\@\+\.\w]+)/) || path.match(/\/([\-\@\+\.\w]+)\/([\-\@\+\.\w]+)/);

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
    floorc_path,
    floorc_lines;

  try {
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
      floorc[key] = value;
      log.debug("%s = %s", key, value);
    });
  } catch (e) {
    log.error("no ~/.floorc file was found");
  }
  return floorc;
};

var parse_dot_floo = function () {
  var parsed_url = {},
    data = lib.utils.load_floo();

  parsed_url = data.url ? parse_url(data.url) : {};

  return parsed_url;
};

var parse_args = function (floorc) {
  var parsed_floo = parse_dot_floo();

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
    floorc = parse_floorc(),
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
    parsed_url = parse_url(args.join);
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
      workspace_url = to_browser_url(args.p === 3448, args.H, args.o, args.w);

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

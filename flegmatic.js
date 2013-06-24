#!/usr/bin/env node
var fs = require('fs');
var tls = require('tls');
var path = require('path');

var async = require('async');
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();
var open = require("open");
var optimist = require('optimist');
var _ = require("underscore");

var lib = require('./lib');
var floo_connection = lib.floo_connection;
var listener = lib.listener;
var api = lib.api;


var parse_url = function (url, cb) {
  var parsed_url = {};

  parsed_url.host = "floobits.com";
  parsed_url.port = 3448;
  parsed_url.klass = tls;
  parsed_url.workspace = "rax-demo";
  parsed_url.owner = "kansface";
  return parsed_url;
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
    console.error("no ~/.floorc file", e);
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
    console.log("no .floo file in current directory");
  }
  return parsed_url;
};

var parse_args = function () {
  var floorc = parse_floorc(),
    parsed_url = parse_dot_floo();

  return optimist
    .usage('Usage: $0 -o [owner] -w [workspace] -u [username] -s [secret] --create [name] --delete --send-local')
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
    // .describe('readonly', 'Will not send patches for local modifications (Always enabled for OS X).')
    .demand(['H', 'p', 'u', 's'])
    .argv;
};

exports.run = function () {
  var cwd = process.cwd(),
    floorc,
    floo_file,
    data,
    parsed_url,
    series = [],
    args = parse_args();

  if (args.help || args.h) {
    optimist.showHelp();
    process.exit(0);
  }

  args.o = args.o || args.u;
  if (args.create && args.create === true) {
    args.create = path.basename(process.cwd());
  }
  args.w = args.create || args.w;

  if (!args.w) {
    console.error('I need a workspace name.');
    optimist.showHelp();
    process.exit(0);
  }

  if (args['delete']) {
    series.push(api.del.bind(api, args.H, args.o, args.s, args.w));
  }

  if (args.create) {
    series.push(api.create.bind(api, args.H, args.o, args.s, args.w, args.perms));
  }

  async.series(series, function (err) {
    var parallel = {},
      floo_conn,
      floo_listener;

    if (err) {
      return console.error(err);
    }
    floo_conn = new floo_connection.FlooConnection(args.H, args.p, args.o, args.w, args.u, args.s);

    parallel.conn = function (cb) {
      floo_conn.connect(cb);
    };

    parallel.listen = function (cb) {
      floo_listener = new listener.Listener(process.cwd(), floo_conn);
      floo_listener.inspect(cb);
    };

    async.parallel(parallel, function (err) {
      if (err) {
        return console.error(err);
      }
      // if (!args.readonly && process.platform !== 'darwin') {
      //   floo_listener.fs_watch();
      // }
      floo_conn.start_syncing(floo_listener, args.create || args['send-local']);
    });
  });
};

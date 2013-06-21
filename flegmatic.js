#!/usr/bin/env node
var fs = require('fs');
var tls = require('tls');

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

  // parsed_url.conn_class = net;

  return parsed_url;
};


exports.run = function () {
  var cwd = process.cwd(),
    floo_file,
    data,
    parsed_url;

  try {
    floo_file = fs.readFileSync(".floo");
    data = JSON.parse(floo_file);
    parsed_url = parse_url(data.url);
  } catch (e) {
    console.log("no floo file");
  }

  var floo_conn = new floo_connection.FlooConnection(parsed_url);
};

"use strict";

var fs = require("fs");
var util = require("util");

var log = require("floorine");
var request = require("request");

var utils = require("./utils");

request = request.defaults({
  strictSSL: true
});

exports.del = function (host, username, owner, secret, workspace, cb) {
  var options = {
    uri: util.format("https://%s/api/workspace/%s/%s", host, owner, workspace)
  };
  request.del(options, cb).auth(username, secret);
};

exports.create = function (host, username, owner, secret, workspace, perms, cb) {
  var err_start = util.format("Could not create workspace %s/%s: ", owner, workspace),
    options,
    url = util.format("https://%s/%s/%s", host, owner, workspace);

  options = {
    uri: util.format("https://%s/api/workspace", host),
    json: {
      name: workspace,
      owner: owner
    }
  };

  if (perms) {
    options.json.perms = perms;
  }

  request.post(options, function (err, result, body) {
    var data = {};

    if (err) {
      log.log("Error creating workspace:", err);
      return cb(err);
    }
    if (body) {
      body = body.detail || body;
    }
    console.log(body, result.statusCode);
    if (result.statusCode === 401) {
      err = new Error(err_start + "Your credentials are wrong. see https://floobits.com/help/floorc" + "\nHTTP status " + result.statusCode + ": " + body);
    }
    if (result.statusCode === 402) {
      err = new Error(err_start + body.toString());
    }
    if (result.statusCode === 403) {
      err = new Error(err_start + "You do not have permission. see https://floobits.com/help/floorc");
    }

    if (result.statusCode === 409) {
      log.warn("This workspace already exists.");
    } else if (result.statusCode >= 400) {
      err = err || new Error(err_start + " HTTP status " + result.statusCode + ": " + body);
      err.statusCode = result.statusCode;
      return cb(err);
    }
    log.log("Created workspace", url);

    data = utils.load_floo();
    data.url = url;
    /*eslint-disable no-sync */
    fs.writeFileSync(".floo", JSON.stringify(data), "utf-8");
    /*eslint-enable no-sync */
    cb();
  }).auth(username, secret);
};

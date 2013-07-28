var fs = require("fs");

var request = require('request');

var log = require("./log");


request = request.defaults({
  strictSSL: true
});

exports.del = function (host, owner, secret, workspace, cb) {
  var options = {
    uri: "https://" + host + '/api/workspace/' + owner + '/' + workspace
  };
  request.del(options, cb).auth(owner, secret);
};

exports.create = function (host, owner, secret, workspace, perms, cb) {
  var err_start = 'Could not create workspace ' + owner + '/' + workspace + ': ',
    options,
    url = 'https://' + host + '/r/' + owner + '/' + workspace;

  options = {
    uri: "https://" + host + '/api/workspace/',
    json: {
      name: workspace
    }
  };

  request.post(options, function (err, result, body) {
    if (err) {
      log.log("Error creating workspace:", err);
      return cb(err);
    }

    if (result.statusCode === 401) {
      return cb(new Error(err_start + 'Your credentials are wrong. see https://floobits.com/help/floorc/' + '\nHTTP status ' + result.statusCode + ': ' + body));
    }
    if (result.statusCode === 402) {
      body = body.detail || body;
      return cb(new Error(err_start + toString(body)));
    }
    if (result.statusCode === 403) {
      return cb(new Error(err_start + 'You do not have permission. see https://floobits.com/help/floorc/'));
    }
    if (result.statusCode === 409) {
      log.warn('This workspace already exists.');
      return cb();
    }
    if (result.statusCode >= 400) {
      return cb(new Error(err_start + ' HTTP status ' + result.statusCode + ': ' + body));
    }
    log.log('Created workspace', url);
    fs.writeFileSync(".floo", JSON.stringify({url: url}), 'utf-8');
    cb();
  }).auth(owner, secret);
};

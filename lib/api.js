var request = require('request');
var open_url = require('open');


request = request.defaults({
  strictSSL: true,
});

exports.del = function (host, owner, secret, workspace, cb) {
  var options = {
    uri: "https://" + host + '/api/workspace/',
    json: {
      name: workspace
    }
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
      console.log("Error creating workspace:", err);
      return cb(err);
    }

    if (result.statusCode === 401) {
      return cb(new Error(err_start + 'Your credentials are wrong. see https://floobits.com/help/floorc/' + '\nHTTP status ' + result.statusCode + ': ' + body));
    } else if (result.statusCode === 403) {
      return cb(new Error(err_start + 'You do not have permission. see https://floobits.com/help/floorc/'));
    } else if (result.statusCode === 409) {
      console.warn('This workspace already exists.');
      return cb();
    } else if (result.statusCode >= 400) {
      return cb(new Error(err_start + ' HTTP status ' + result.statusCode + ': ' + body));
    }
    open_url(url + '/settings');
    console.log('made workspace', url);
    cb();
  }).auth(owner, secret);
};

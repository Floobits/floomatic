var request = require('request');

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
  var options = {
    uri: "https://" + host + '/api/workspace/',
    json: {
      name: workspace
    }
  };

  request.post(options, function (err) {
    if (err) {
      return cb(err);
    }
    console.log('made workspace: https://' + host + '/r/' + owner + '/' + workspace);
    cb();
  }).auth(owner, secret);
};

var request = require('request');

exports.del = function (host, owner, workspace, cb) {
  cb = cb || function () {};

  request.del("https://" + host + '/api/workspace/' + owner + '/' + workspace,  cb);
};

exports.create = function (host, owner, secret, workspace, perms, cb) {
  var options = {
    uri: "https://" + host + '/api/workspace/',
    json: {
      name: workspace
    }
  };
  cb = cb || function () {};

  request.post(options, function(err){
    if (err) return cb(err);
    console.log('made workspace: https://' + host + '/r/' + owner + '/' + workspace);
    cb();
  }).auth(owner, secret);
};

var request = require('request');

exports.del = function(host, owner, workspace, cb){
  cb = cb || function(){};

  request.del("https://" + host + '/api/workspace/' + owner + '/' + workspace,  cb);
};

exports.create = function(host, owner, workspace, cb){
  cb = cb || function(){};

  request.post("https://" + host + '/api/workspace/' + owner + '/' + workspace,  cb);
};
#!/usr/bin/env node
var fs = require('fs');
var path = require('path');

var async = require('async');
var _ = require("underscore");

var watchers = {};
var current_state = {};

var main = function(){
  var cwd = process.cwd();
  console.log('watching cwd', cwd);
  watch(cwd);
};

var watch = function(to_watch){
  var sub_dirs = [],
    files = [],
    iter,
    children = fs.readdirSync(to_watch).map(function(child){
      return path.join(to_watch, child);
    });

  iter = function(p, cb){
    console.log(p);
    fs.lstat(p, function(err, stats){
      if (stats.isDirectory()){
        sub_dirs.push(p);
      } else if (stats.isFile()) {
        files.push(p);
      }
      return cb();
    });
  };

  async.eachLimit(children, 10, iter, function(err){
    sub_dirs.forEach(watch);
    files.forEach(add_listener);
    add_listener(to_watch, true);
  });
};

var add_listener = function(f, is_dir){
  is_dir = is_dir === true ? true : false;
  fs.readFile(f, function(err, buf){
    current_state[f] = buf;
    fs.watch(f, listener.bind(null, f, is_dir));
  });

};

var listener = function(original_path, is_dir, event, filename){
  if (!is_dir && event != 'rename'){
    buf = fs.readFileSync(original_path);
    console.log(buf.toString(), current_state[original_path].toString());
  }
  console.log(event, original_path, is_dir);
};
main();
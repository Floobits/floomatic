var events = require("events"),
  net = require('net'),
  tls = require('tls'),
  util = require("util");

var _ = require("underscore");


var CLIENT = "flegmatic";
var __VERSION__ = "0.01";


var FlooConnection = function (host, port, owner, workspace, username, secret) {
  var self = this;

  events.EventEmitter.call(self);

  self.host = host;
  self.port = port;
  self.username = username;
  self.secret = secret;
  self.workspace = workspace;
  self.owner = owner;
  self.conn_buf = "";
  self.room_info = null;
  self.perms = [];
};

util.inherits(FlooConnection, events.EventEmitter);

FlooConnection.prototype.listener_ready = function (listener) {
  var self = this;
  self.listener = listener;
  if (self.room_info) {
    self.start_syncing();
  } else {
    self.after_room_info = self.start_syncing;
  }
};

FlooConnection.prototype.connect = function (username, secret) {
  var self = this,
    parsed_url = self.parsed_url;

  self.username = username || self.username;
  self.secret = secret || self.secret;

  self.conn_buf = "";

  self.conn = tls.connect(self.port, self.host, function () {
    self.send_auth();
  });
  self.conn.on('end', function () {
    console.warn('socket is gone');
  });
  self.conn.on('data', self.data_handler.bind(self));
  self.conn.on('error', function (err) {
    console.error('Connection error:', err);
    process.exit(1);
  });
};

FlooConnection.prototype.handle_msg = function (msg) {
  var self = this,
    f;

  try {
    msg = JSON.parse(msg);
  } catch (e) {
    console.error("couldn't parse json:", msg, "error:", e);
    throw e;
  }

  // console.info("calling", msg.name);
  f = self["on_" + msg.name];
  if (_.isFunction(f)) {
    return f.call(self, msg);
  }
  console.info("No handler for", msg.name, "event");
};

FlooConnection.prototype.data_handler = function (d) {
  var self = this,
    auth_data,
    msg,
    newline_index;

  // console.info("d: |" + d + "|");

  self.conn_buf += d;

  newline_index = self.conn_buf.indexOf("\n");
  while (newline_index !== -1) {
    msg = self.conn_buf.slice(0, newline_index);
    self.conn_buf = self.conn_buf.slice(newline_index + 1);
    self.handle_msg(msg);
    newline_index = self.conn_buf.indexOf("\n");
  }
};

FlooConnection.prototype.write = function (name, json) {
  var self = this,
    str;

  if (!self.room_info) {
    return;
  }

  json.name = name;
  str = JSON.stringify(json);
  console.info("writing to conn:", str);
  try {
    self.conn.write(str + "\n");
  } catch (e) {
    console.error("error writing to client:", e, "disconnecting");
    process.exit(1);
  }
};

FlooConnection.prototype.send_auth = function () {
  var self = this,
    str;

  str = JSON.stringify({
    'username': self.username,
    'secret': self.secret,
    'room': self.workspace,
    'room_owner': self.owner,
    'client': CLIENT,
    'platform': process.platform,
    'version': __VERSION__
  }) + "\n";

  console.info("writing to conn:", str);
  self.conn.write(str);
};

FlooConnection.prototype.send_get_buf = function (buf_id) {
  this.write('get_buf', {id: buf_id});
};

FlooConnection.prototype.on_room_info = function (d) {
  var self = this;

  self.room_info = d;
  self.perms = d.perms;

  if (self.after_room_info) {
    self.start_syncing();
  }
};

FlooConnection.prototype.start_syncing = function () {
  var self = this,
    listener_bufs = self.listener.bufs;

  _.each(self.room_info.bufs, function (buf, id) {
    var existing = listener_bufs[buf.path];
    if (!existing) {
      listener_bufs[buf.path] = buf;
      return self.send_get_buf(buf.id);
    }

    existing.id = id;

    if (existing.md5 !== buf.md5) {
      delete existing.buf;
      return self.send_get_buf(buf.id);
    }
  });
};

FlooConnection.prototype.on_get_buf = function (buf) {
  var self = this;

  self.listener.write(buf.path, buf.md5, buf.buf);
};

FlooConnection.prototype.on_join = function (d) {

};

FlooConnection.prototype.on_part = function (d) {

};

FlooConnection.prototype.on_patch = function (d) {
  var self = this;

  self.listener.patch(d.path, d.patch, d.md5_after, d.id);
};

FlooConnection.prototype.on_delete_buf = function (d) {

};

FlooConnection.prototype.on_highlight = function (d) {

};

FlooConnection.prototype.on_error = function (d) {
  console.error(d);
};

FlooConnection.prototype.on_disconnect = function (d) {
  console.error(d);
  this.conn.destroy();
};

FlooConnection.prototype.on_term_stdout = function (d) {

};
FlooConnection.prototype.on_term_stdin = function (d) {

};


exports.FlooConnection = FlooConnection;
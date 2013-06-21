var events = require("events");
var net = require('net');
var tls = require('tls');
var util = require("util");

var _ = require("underscore");

var listener = require("./listener");

var FlooConnection = function (parsed_url) {
  var self = this;

  events.EventEmitter.call(self);

  self.parsed_url = parsed_url;
  self.conn = parsed_url.klass.connect(parsed_url.port, parsed_url.host, function () {
    console.log('watching cwd', process.cwd());
    self.listener = new listener.Listener(process.cwd(), self);
  });

  self.conn.on('data', self.data_handler.bind(self));
  self.conn.on('error', function (err) {
    console.error('Connection error:', err);
    process.exit(1);
  });

  self.conn_buf = "";
};

util.inherits(FlooConnection, events.EventEmitter);

FlooConnection.prototype.handle_msg = function (msg) {
  var self = this,
    f;

  try {
    msg = JSON.parse(msg);
  } catch (e) {
    console.error("couldn't parse json:", msg, "error:", e);
    throw e;
  }

  console.debug("calling", msg.name);
  f = self["on_" + msg.name];
  if (_.isFunction(f)) {
    return f.call(self, msg);
  }
  console.debug("No handler for", msg.name, "event");
};

FlooConnection.prototype.data_handler = function (d) {
  var self = this,
    auth_data,
    msg,
    newline_index;

  console.debug("d: |" + d + "|");

  self.conn_buf += d;

  newline_index = self.conn_buf.indexOf("\n");
  while (newline_index !== -1) {
    msg = self.conn_buf.slice(0, newline_index);
    self.conn_buf = self.conn_buf.slice(newline_index + 1);
    self.handle_msg(msg);
    newline_index = self.conn_buf.indexOf("\n");
  }
};

exports.FlooConnection = FlooConnection;
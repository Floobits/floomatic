var events = require("events"),
  net = require('net'),
  tls = require('tls'),
  util = require("util");

var _ = require("underscore");
var dmp_module = require("diff_match_patch");
var DMP = new dmp_module.diff_match_patch();

var log = require("./log");
var utils = require("./utils");


var CLIENT = "flegmatic";
var __VERSION__ = "0.02";


var FlooConnection = function (host, port, owner, workspace, username, secret, readonly) {
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
  self.on_connect = null;
  self.readonly = readonly;
  self.get_buf_cb = {};
};

util.inherits(FlooConnection, events.EventEmitter);

FlooConnection.prototype.connect = function (cb) {
  var self = this,
    parsed_url = self.parsed_url;

  self.on_connect = cb;

  self.conn_buf = "";

  self.conn = tls.connect(self.port, self.host, function () {
    self.send_auth();
  });
  self.conn.on('end', function () {
    log.warn('socket is gone');
    if (self.on_connect) {
      self.on_connect('Socket was killed');
    }
  });
  self.conn.on('data', self.data_handler.bind(self));
  self.conn.on('error', function (err) {
    log.error('Connection error:', err);
    process.exit(1);
  });
};

FlooConnection.prototype.handle_msg = function (msg) {
  var self = this,
    f;

  try {
    msg = JSON.parse(msg);
  } catch (e) {
    log.error("couldn't parse json:", msg, "error:", e);
    throw e;
  }

  // log.debug("calling", msg.name);
  f = self["on_" + msg.name];
  if (_.isFunction(f)) {
    return f.call(self, msg);
  }
  log.debug("No handler for", msg.name, "event");
};

FlooConnection.prototype.data_handler = function (d) {
  var self = this,
    auth_data,
    msg,
    newline_index;

  // log.debug("d: |" + d + "|");

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
  log.debug("writing to conn:", str);
  try {
    self.conn.write(str + "\n");
  } catch (e) {
    log.error("error writing to client:", e, "disconnecting");
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

  log.debug("writing to conn:", str);
  self.conn.write(str);
};

FlooConnection.prototype.send_get_buf = function (buf_id) {
  var self = this;
  self.write('get_buf', {id: buf_id});
};

FlooConnection.prototype.send_create_buf = function (path, buf_buf, md5) {
  var self = this;

  if (self.readonly) {
    return;
  }

  self.write('create_buf', {
    path: path,
    buf: buf_buf.toString(),
    md5: md5
  });
};

FlooConnection.prototype.send_delete_buf = function (buf_id) {
  var self = this;

  self.write('delete_buf', {
    'id': buf_id
  });
};

FlooConnection.prototype.send_patch = function (buf, after_text) {
  var self = this,
    patches,
    md5_after;

  if (self.readonly) {
    return;
  }

  patches = DMP.patch_make(buf.buf.toString(), after_text);
  md5_after = utils.md5(after_text);

  self.write('patch', {
    'id': buf.id,
    'md5_after': md5_after,
    'md5_before': buf.md5,
    'path': buf.path,
    'patch': DMP.patch_toText(patches)
  });

  buf.buf = after_text;
  buf.md5 = md5_after;
};

FlooConnection.prototype.on_room_info = function (d) {
  var self = this;

  self.room_info = d;
  self.perms = d.perms;
  self.bufs = self.room_info.bufs;

  self.on_connect();
  self.on_connect = null;
};

FlooConnection.prototype.start_syncing = function (listener, create_workspace) {
  var self = this,
    listener_bufs;

  log.log("starting syncing");

  self.listener = listener;
  listener_bufs = self.listener.bufs;

  _.each(self.room_info.bufs, function (buf, id) {
    var existing = listener_bufs[buf.path];

    if (!existing) {
      listener_bufs[buf.path] = buf;
      if (create_workspace) {
        return self.send_delete_buf(buf.id);
      }
      return self.send_get_buf(buf.id);
    }

    existing.id = id;
    existing.path = buf.path;

    if (existing.md5 !== buf.md5) {
      log.log("buf", buf.path, "md5 sum mismatch. re-fetching...");
      self.send_get_buf(buf.id);
      if (create_workspace) {
        self.get_buf_cb[buf.id] = function () {
          log.log("got buf", buf.path, "back. patching because of md5 sum mismatch...");
          self.send_patch(self.room_info.bufs[buf.id], existing.buf.toString());
        };
      } else {
        delete existing.buf;
      }
      return;
    }
  });

  _.each(self.listener.bufs, function (buf, _path) {
    if (!buf.id) {
      log.log("buf", _path, "doesn't exist. creating...");
      // TODO: we probably want a list of bufs that are being created
      self.send_create_buf(_path, buf.buf, buf.md5);
      delete buf.buf;
    }
  });

  log.log("all done syncing");
};

FlooConnection.prototype.on_get_buf = function (buf) {
  var self = this;
  self.room_info.bufs[buf.id] = buf;
  if (self.get_buf_cb[buf.id]) {
    self.get_buf_cb[buf.id]();
    delete self.get_buf_cb[buf.id];
  }
  self.listener.write(buf.path, buf.buf, buf.md5);
};

FlooConnection.prototype.on_create_buf = function (buf) {
  var self = this;

  self.on_get_buf(buf);
};

FlooConnection.prototype.on_rename_buf = function (d) {
  var self = this,
    buf = self.room_info.bufs[d.id],
    old_path = buf.path;

  buf.path = d.path;
  self.listener.rename(old_path, d.path);
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
  var self = this;

  self.listener.delete_buf(d.path);
};

FlooConnection.prototype.on_highlight = function (d) {

};

FlooConnection.prototype.on_error = function (d) {
  log.error(d);
};

FlooConnection.prototype.on_disconnect = function (d) {
  log.error(d);
  this.conn.destroy();
};

FlooConnection.prototype.on_term_stdout = function (d) {

};

FlooConnection.prototype.on_term_stdin = function (d) {

};


exports.FlooConnection = FlooConnection;

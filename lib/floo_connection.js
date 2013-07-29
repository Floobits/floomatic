var events = require("events"),
  net = require('net'),
  path = require('path'),
  tls = require('tls'),
  util = require("util");

var _ = require("lodash");
var DMP;
var dmp_module = require("diff_match_patch");
var JS_DMP = new dmp_module.diff_match_patch();

var ignores = require("./ignores");
var log = require("./log");
var utils = require("./utils");


var CLIENT = "flegmatic";
var __VERSION__ = "0.03";

try {
  DMP = require("native-diff-match-patch");
} catch (e) {
  log.warn("No native-diff-match-patch. You won't be able to patch binary files.");
}


var FlooConnection = function (host, port, owner, workspace, username, secret, readonly, hooker) {
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
  self.hooker = hooker;
  self.reconnect_timeout = null;
  self.reconnect_delay = 500;
  self.connected = false;
};

util.inherits(FlooConnection, events.EventEmitter);

FlooConnection.prototype.user_id_to_name = function (id) {
  var self = this,
    user = self.room_info.users[id];

  return (user ? user.username : id);
};

FlooConnection.prototype.buf_id_to_path = function (id) {
  var self = this,
    buf = self.room_info.bufs[id];

  return (buf ? buf.path : '');
};

FlooConnection.prototype.connect = function (cb) {
  var self = this,
    parsed_url = self.parsed_url;

  clearTimeout(self.reconnect_timeout);
  self.reconnect_timeout = null;

  self.on_connect = cb;
  self.conn_buf = "";

  self.conn = tls.connect(self.port, self.host, function () {
    self.send_auth();
  });
  self.conn.on('end', function () {
    log.warn('socket is gone');
    self.reconnect();
  });
  self.conn.on('data', self.data_handler.bind(self));
  self.conn.on('error', function (err) {
    log.error('Connection error:', err);
    self.reconnect();
  });
};

FlooConnection.prototype.reconnect = function (msg) {
  var self = this, cb;

  if (self.reconnect_timeout) {
    return;
  }
  self.room_info = {};
  self.perms = [];
  self.connected = false;
  cb = self.start_syncing.bind(self, self.listener, self.create_workspace);
  self.reconnect_timeout = setTimeout(self.connect.bind(self, cb), self.reconnect_delay);
  self.reconnect_delay = Math.min(10000, Math.floor(1.5 * self.reconnect_delay));
  log.log('reconnecting in ', self.reconnect_delay);
  try {
    self.conn.close();
  } catch (e) {}
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

  log.debug("calling", msg.name);
  f = self['on_' + msg.name];

  if (_.isFunction(f)) {
    return f.call(self, msg);
  }
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

  if (!self.connected) {
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
    'supported_encodings': ['utf8', 'base64'],
    'version': __VERSION__
  }) + "\n";

  log.debug("writing to conn:", str);
  self.conn.write(str);
};

FlooConnection.prototype.send_get_buf = function (buf_id) {
  var self = this;
  self.write('get_buf', {id: buf_id});
};

FlooConnection.prototype.send_create_buf = function (buf, ignore) {
  var self = this,
    is_ignored;

  if (self.readonly) {
    return;
  }
  ignore = ignore || ignores.build_ignores(path.dirname(buf.path), self.listener.path);
  is_ignored = ignore.is_ignored(buf.path);

  if (is_ignored) {
    return;
  }
  log.log("buf", buf.path, "doesn't exist. creating...");

  self.write('create_buf', {
    buf: buf.buf.toString(buf.encoding),
    encoding: buf.encoding,
    md5: buf.md5,
    path: buf.path
  });
};

FlooConnection.prototype.send_delete_buf = function (buf_id) {
  var self = this;

  self.write('delete_buf', {
    'id': buf_id
  });
};

FlooConnection.prototype.send_patch = function (buf, after) {
  var self = this,
    patches,
    patch_text,
    md5_after;

  if (self.readonly) {
    return;
  }

  switch (buf.encoding) {
  case 'utf8':
    patches = JS_DMP.patch_make(buf.buf.toString(), after.toString());
    patch_text = JS_DMP.patch_toText(patches);
    break;
  case "base64":
    if (!DMP) {
      return log.warn(util.format("Can't make patch for %s: No native-diff-match-patch module.", buf.path));
    }
    patch_text = DMP.patch_make(buf.buf, after);
    break;
  default:
    return log.warn(util.format("Can't make patch for %s: Unknown encoding %s.", buf.path, buf.encoding));
  }

  md5_after = utils.md5(after);

  self.write('patch', {
    'id': buf.id,
    'md5_after': md5_after,
    'md5_before': buf.md5,
    'path': buf.path,
    'patch': patch_text
  });

  buf.buf = after;
  buf.md5 = md5_after;
};

FlooConnection.prototype.on_room_info = function (d) {
  var self = this;

  self.room_info = d;
  self.perms = d.perms;
  self.bufs = self.room_info.bufs;

  self.connected = true;
  self.reconnect_timeout = null;
  self.reconnect_delay = 500;

  if (self.on_connect) {
    self.on_connect();
    self.on_connect = null;
  }
};

FlooConnection.prototype.start_syncing = function (listener, create_workspace) {
  var self = this,
    listener_bufs;

  log.log("starting syncing");

  self.listener = listener;
  self.create_workspace = create_workspace;
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
      log.log("buf", buf.path, "md5 sum mismatch. re-fetching...", existing.md5, buf.md5);
      self.send_get_buf(buf.id);
      if (create_workspace) {
        self.get_buf_cb[buf.id] = function () {
          self.send_patch(self.room_info.bufs[buf.id], existing.buf);
        };
      } else {
        delete existing.buf;
      }
      return;
    }
  });

  _.each(self.listener.bufs, function (buf, _path) {
    if (!buf.id) {
      // TODO: we probably want a list of bufs that are being created
      self.send_create_buf(buf);
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

  self.listener.write(buf.path, new Buffer(buf.buf, buf.encoding), buf.md5, buf.encoding);
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
  var self = this;

  log.log(d.username + ' joined the room on ' + d.platform);
  self.room_info.users[d.user_id] = d;
};

FlooConnection.prototype.on_part = function (d) {
  log.log(d.username + ' joined the room');
};

FlooConnection.prototype.on_saved = function (d) {
  var self = this,
    username = self.user_id_to_name(d.user_id),
    _path = self.buf_id_to_path(d.id);

  log.log(_path + ' was saved by ' + username);

  self.hooker.on_saved(_path);
};

FlooConnection.prototype.on_patch = function (d) {
  var self = this;

  self.listener.patch(d.path, d.patch, d.md5_after, d.id);
};

FlooConnection.prototype.on_delete_buf = function (d) {
  var self = this;

  self.listener.delete_buf(d.path);
};

FlooConnection.prototype.on_error = function (d) {
  log.error(d);
};

FlooConnection.prototype.on_disconnect = function (d) {
  log.error('You were disconnected because', d.reason);
  process.exit(1);
};

FlooConnection.prototype.on_highlight = function () {

};

module.exports = FlooConnection;

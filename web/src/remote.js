/**
 * Copyright © Charles Kerr, Dave Perrett, Malcolm Jarvis and Bruno Bierbaumer
 *
 * This file is licensed under the GPLv2.
 * http://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 */

export const RPC = {
  _DaemonVersion: 'version',
  _DownSpeedLimit: 'speed-limit-down',
  _DownSpeedLimited: 'speed-limit-down-enabled',
  _QueueMoveBottom: 'queue-move-bottom',
  _QueueMoveDown: 'queue-move-down',
  _QueueMoveTop: 'queue-move-top',
  _QueueMoveUp: 'queue-move-up',
  _Root: '../rpc',
  _TurtleDownSpeedLimit: 'alt-speed-down',
  _TurtleState: 'alt-speed-enabled',
  _TurtleUpSpeedLimit: 'alt-speed-up',
  _UpSpeedLimit: 'speed-limit-up',
  _UpSpeedLimited: 'speed-limit-up-enabled',
};

export class Remote {
  constructor(controller, dialog) {
    this._controller = controller;
    this._dialog = dialog;
    this._error = '';
    this._session_id = '';
  }

  sendRequest(data, callback, context) {
    const headers = new Headers();
    headers.append('cache-control', 'no-cache');
    headers.append('content-type', 'application/json');
    headers.append('pragma', 'no-cache');
    if (this._session_id) {
      headers.append(Remote._SessionHeader, this._session_id);
    }

    let response_arg = null;
    fetch(RPC._Root, {
      body: JSON.stringify(data),
      headers,
      method: 'POST',
    })
      .then((response) => {
        response_arg = response;
        if (response.status === 409) {
          const error = new Error(Remote._SessionHeader);
          error.header = response.headers.get(Remote._SessionHeader);
          throw error;
        }
        return response.json();
      })
      .then((payload) => {
        callback.call(context, payload, response_arg);
      })
      .catch((error) => {
        if (error.message === Remote._SessionHeader) {
          // copy the session header and try again
          this._session_id = error.header;
          this.sendRequest(data, callback, context);
          return;
        }
        this._dialog.confirm(
          'Connection Failed',
          'Could not connect to the server. You may need to reload the page to reconnect.',
          'Details',
          () => alert(`${error}`),
          'Dismiss'
        );
        this._controller.togglePeriodicSessionRefresh(false);
      });
  }

  loadDaemonPrefs(callback, context) {
    const o = {
      method: 'session-get',
    };
    this.sendRequest(o, callback, context);
  }

  checkPort(callback, context) {
    const o = {
      method: 'port-test',
    };
    this.sendRequest(o, callback, context);
  }

  renameTorrent(torrentIds, oldpath, newname, callback, context) {
    const o = {
      arguments: {
        ids: torrentIds,
        name: newname,
        path: oldpath,
      },
      method: 'torrent-rename-path',
    };
    this.sendRequest(o, callback, context);
  }

  loadDaemonStats(callback, context) {
    const o = {
      method: 'session-stats',
    };
    this.sendRequest(o, callback, context);
  }

  updateTorrents(torrentIds, fields, callback, context) {
    const o = {
      arguments: {
        fields,
        format: 'table',
      },
      method: 'torrent-get',
    };
    if (torrentIds) {
      o.arguments.ids = torrentIds;
    }
    this.sendRequest(o, (response) => {
      const args = response['arguments'];
      callback.call(context, args.torrents, args.removed);
    });
  }

  getFreeSpace(dir, callback, context) {
    const o = {
      arguments: {
        path: dir,
      },
      method: 'free-space',
    };
    this.sendRequest(o, (response) => {
      const args = response['arguments'];
      callback.call(context, args.path, args['size-bytes']);
    });
  }

  changeFileCommand(torrentId, fileIndices, command) {
    const args = {
      ids: [torrentId],
    };
    args[command] = fileIndices;
    this.sendRequest(
      {
        arguments: args,
        method: 'torrent-set',
      },
      () => {
        this._controller.refreshTorrents([torrentId]);
      }
    );
  }

  sendTorrentSetRequests(method, torrent_ids, args, callback, context) {
    if (!args) {
      args = {};
    }
    args['ids'] = torrent_ids;
    const o = {
      arguments: args,
      method,
    };
    this.sendRequest(o, callback, context);
  }

  sendTorrentActionRequests(method, torrent_ids, callback, context) {
    this.sendTorrentSetRequests(method, torrent_ids, null, callback, context);
  }

  startTorrents(torrent_ids, noqueue, callback, context) {
    const name = noqueue ? 'torrent-start-now' : 'torrent-start';
    this.sendTorrentActionRequests(name, torrent_ids, callback, context);
  }
  stopTorrents(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      'torrent-stop',
      torrent_ids,
      callback,
      context
    );
  }

  moveTorrents(torrent_ids, new_location, callback, context) {
    this.sendTorrentSetRequests(
      'torrent-set-location',
      torrent_ids,
      {
        location: new_location,
        move: true,
      },
      callback,
      context
    );
  }

  removeTorrents(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      'torrent-remove',
      torrent_ids,
      callback,
      context
    );
  }
  removeTorrentsAndData(torrents) {
    const o = {
      arguments: {
        'delete-local-data': true,
        ids: [],
      },
      method: 'torrent-remove',
    };

    if (torrents) {
      for (let i = 0, len = torrents.length; i < len; ++i) {
        o.arguments.ids.push(torrents[i].getId());
      }
    }
    this.sendRequest(o, () => {
      this._controller.refreshTorrents();
    });
  }
  verifyTorrents(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      'torrent-verify',
      torrent_ids,
      callback,
      context
    );
  }
  reannounceTorrents(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      'torrent-reannounce',
      torrent_ids,
      callback,
      context
    );
  }
  addTorrentByUrl(url, options) {
    if (url.match(/^[0-9a-f]{40}$/i)) {
      url = `magnet:?xt=urn:btih:${url}`;
    }
    const o = {
      arguments: {
        filename: url,
        paused: options.paused,
      },
      method: 'torrent-add',
    };
    this.sendRequest(o, () => {
      this._controller.refreshTorrents();
    });
  }
  savePrefs(args) {
    const o = {
      arguments: args,
      method: 'session-set',
    };
    this.sendRequest(o, () => {
      this._controller.loadDaemonPrefs();
    });
  }
  updateBlocklist() {
    const o = {
      method: 'blocklist-update',
    };
    this.sendRequest(o, () => {
      this._controller.loadDaemonPrefs();
    });
  }

  // Added queue calls
  moveTorrentsToTop(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      RPC._QueueMoveTop,
      torrent_ids,
      callback,
      context
    );
  }
  moveTorrentsToBottom(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      RPC._QueueMoveBottom,
      torrent_ids,
      callback,
      context
    );
  }
  moveTorrentsUp(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      RPC._QueueMoveUp,
      torrent_ids,
      callback,
      context
    );
  }
  moveTorrentsDown(torrent_ids, callback, context) {
    this.sendTorrentActionRequests(
      RPC._QueueMoveDown,
      torrent_ids,
      callback,
      context
    );
  }
}

Remote._SessionHeader = 'X-Transmission-Session-Id';

/**
 * Copyright © Charles Kerr, Dave Perrett, Malcolm Jarvis and Bruno Bierbaumer
 *
 * This file is licensed under the GPLv2.
 * http://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 */

import AccessibleMenu from 'accessible-menu';

import { Dialog } from './dialog.js';
import { Formatter } from './formatter.js';
import { Inspector } from './inspector.js';
import { Prefs } from './prefs.js';
import { PrefsDialog } from './prefs-dialog.js';
import { Remote, RPC } from './remote.js';
import { Torrent } from './torrent.js';
import { TorrentRow, TorrentRendererCompact, TorrentRendererFull } from './torrent-row.js';
import { isMobileDevice, Utils } from './utils.js';

export class Transmission {
  constructor(dialog, notifications, prefs) {
    // Initialize the helper classes
    this.dialog = dialog;
    this.notifications = notifications;
    this.prefs = prefs;
    this.remote = new Remote(this, dialog);
    this.inspector = new Inspector(this);
    this.prefsDialog = new PrefsDialog(this.remote);
    this.prefsDialog.addEventListener('closed', Transmission.onPrefsDialogClosed);

    this.isMenuEnabled = !isMobileDevice;

    // zzz
    //const closeClass = "closed";
    const containerElement = document.getElementById('toolbar-more');
    const controllerElement = containerElement;
    const menuElement = document.querySelector('#main-menu');
    const menuItemSelector = '.menu-item';
    const menuLinkSelector = '.menu-link';
    // const openClass = "open";
    const submenuItemSelector = '.menu-item.dropdown';
    const submenuSelector = '.menu.dropdown';
    const submenuToggleSelector = '.menu-link.toggle';

    this.menu = new AccessibleMenu.DisclosureMenu({
      //closeClass,
      containerElement,
      controllerElement,
      menuElement,
      menuItemSelector,
      menuLinkSelector,
      //openClass,
      submenuItemSelector,
      submenuSelector,
      submenuToggleSelector,
    });
    // zzz

    // Initialize the implementation fields
    this.filterText = '';
    this._torrents = {};
    this._rows = [];
    this.dirtyTorrents = new Set();
    this.uriCache = {};

    this.refilterSoon = Utils.debounce(() => this.refilter(false), 100);
    this.refilterAllSoon = Utils.debounce(() => this.refilter(true), 100);
    this.updateButtonsSoon = Utils.debounce(() => this.updateButtonStates(), 100);
    this.callSelectionChangedSoon = Utils.debounce(() => this.selectionChanged(), 200);

    // Set up user events
    const listen = (key, name, cb) => document.getElementById(key).addEventListener(name, cb);
    const click = (key, cb) => listen(key, 'click', cb);
    click('compact-button', this.toggleCompactClicked.bind(this));
    click('hotkeys-dialog-close-button', Transmission.closeHotkeysDialog);
    click('about-dialog-close-button', Transmission.closeAboutDialog);
    click('stats-dialog-close-button', this.closeStatsDialog.bind(this));
    click('move-cancel-button', this.hideMoveDialog.bind(this));
    click('move-confirm-button', this.confirmMoveClicked.bind(this));
    click('prefs-button', this.togglePrefsDialogClicked.bind(this));
    click('rename-cancel-button', Transmission.hideRenameDialog);
    click('rename-confirm-button', this.confirmRenameClicked.bind(this));
    click('toolbar-inspector', this.toggleInspector.bind(this));
    click('toolbar-more', this.toggleMore.bind(this));
    click('toolbar-open', this.openTorrentClicked.bind(this));
    click('toolbar-pause', this.stopSelectedClicked.bind(this));
    click('toolbar-pause-all', this.stopAllClicked.bind(this));
    click('toolbar-remove', this.removeClicked.bind(this));
    click('toolbar-start', this.startSelectedClicked.bind(this));
    click('toolbar-start-all', this.startAllClicked.bind(this));
    click('turtle-button', this.toggleTurtleClicked.bind(this));
    click('upload-cancel-button', this.hideUploadDialog.bind(this));
    click('upload-confirm-button', this.confirmUploadClicked.bind(this));

    // tell jQuery to copy the dataTransfer property from events over if it exists
    //FIXME
    // $.event.props.push('dataTransfer');

    document.getElementById('torrent-upload-form').addEventListener('submit', (ev) => {
      this.confirmUploadClicked();
      ev.preventDefault();
    });

    let e = document.getElementById('filter-mode');
    e.value = this.prefs.filter_mode;
    e.addEventListener('change', this.onFilterModeClicked.bind(this));
    listen('filter-tracker', 'change', this.onFilterTrackerClicked.bind(this));

    if (!isMobileDevice) {
      document.addEventListener('keydown', this.keyDown.bind(this));
      document.addEventListener('keyup', this.keyUp.bind(this));
      e = document.getElementById('torrent-container');
      e.addEventListener('click', this.deselectAll.bind(this));
      e.addEventListener('dragenter', Transmission.dragenter);
      e.addEventListener('dragover', Transmission.dragenter);
      e.addEventListener('drop', this.drop.bind(this));

      this.setupSearchBox();
      this.createContextMenu();
    }

    e = {};
    e.torrent_list = document.getElementById('torrent-list');
    e.toolbar_pause_button = document.getElementById('toolbar-pause');
    e.toolbar_start_button = document.getElementById('toolbar-start');
    e.toolbar_remove_button = document.getElementById('toolbar-remove');
    this.elements = e;

    if (this.isMenuEnabled) {
      this.createSettingsMenu();
    }

    // Get preferences & torrents from the daemon
    const async = false;
    this.loadDaemonPrefs(async);
    this.initializeTorrents();
    this.refreshTorrents();
    this.togglePeriodicSessionRefresh(true);

    this.updateButtonsSoon();

    this.prefs.addEventListener('change', ({ key, value }) => this.onPrefChanged(key, value));
    this.prefs.entries().forEach(([key, value]) => this.onPrefChanged(key, value));
  }

  loadDaemonPrefs(async) {
    this.remote.loadDaemonPrefs(
      (data) => {
        const o = data['arguments'];
        // Prefs.getClutchPrefs(o); // FIXME -- is this needed
        this.updateGuiFromSession(o);
        this.sessionProperties = o;
      },
      this,
      async
    );
  }

  setupSearchBox() {
    const e = document.getElementById('torrent-search');
    const blur_token = 'blur';
    e.classList.add(blur_token);
    e.addEventListener('blur', () => e.classList.add(blur_token));
    e.addEventListener('focus', () => e.classList.remove(blur_token));
    e.addEventListener('keyup', () => this.setFilterText(e.value));
  }

  /**
   * Create the torrent right-click menu
   */
  createContextMenu() {
    const tr = this;
    const bindings = {
      deselect_all() {
        tr.deselectAll();
      },
      move() {
        tr.moveSelectedTorrents(false);
      },
      move_bottom() {
        tr.moveBottom();
      },
      move_down() {
        tr.moveDown();
      },
      move_top() {
        tr.moveTop();
      },
      move_up() {
        tr.moveUp();
      },
      pause_selected() {
        tr.stopSelectedTorrents();
      },
      reannounce() {
        tr.reannounceSelectedTorrents();
      },
      remove() {
        tr.removeSelectedTorrents();
      },
      remove_data() {
        tr.removeSelectedTorrentsAndData();
      },
      rename() {
        tr.renameSelectedTorrents();
      },
      resume_now_selected() {
        tr.startSelectedTorrents(true);
      },
      resume_selected() {
        tr.startSelectedTorrents(false);
      },
      select_all() {
        tr.selectAll();
      },
      verify() {
        tr.verifySelectedTorrents();
      },
    };

    // Set up the context menu
    $('ul#torrent-list').contextmenu({
      beforeOpen: function (event) {
        // ensure the clicked row is selected
        const e = event.currentTarget;
        const row = this._rows.find((r) => r.getElement() === e);
        if (row && !row.isSelected()) {
          this.setSelectedRow(row);
        }

        this.calculateTorrentStates((s) => {
          const tl = $(event.target);
          tl.contextmenu('enableEntry', 'pause-selected', s.activeSel > 0);
          tl.contextmenu('enableEntry', 'resume-selected', s.pausedSel > 0);
          tl.contextmenu('enableEntry', 'resume-now-selected', s.pausedSel > 0 || s.queuedSel > 0);
          tl.contextmenu('enableEntry', 'rename', s.sel === 1);
        });
      }.bind(this),
      delegate: '.torrent',
      hide: {
        effect: 'none',
      },
      menu: '#torrent-context-menu',
      preventSelect: true,
      select(event, ui) {
        bindings[ui.cmd.replaceAll('-', '_')]();
      },
      show: {
        effect: 'none',
      },
      taphold: true,
    });
  }

  createSettingsMenu() {
    const e = document.getElementById('settings-menu');
    $('#footer-super-menu').transMenu({
      close() {
        e.classList.remove('selected');
      },
      open() {
        e.classList.add('selected');
      },
      select: this.onMenuClicked.bind(this),
    });
    $('#settings-menu').click(() => {
      $('#footer-super-menu').transMenu('open');
    });
  }

  ///

  onPrefChanged(key, value) {
    switch (key) {
      case Prefs.DisplayMode: {
        const compact = value === Prefs.DisplayCompact;
        document.getElementById('compact-button').classList.toggle('selected', compact);
        this.torrentRenderer = compact ? new TorrentRendererCompact() : new TorrentRendererFull();
        this.refilterAllSoon();
        break;
      }

      case Prefs.SortMode:
      case Prefs.SortDirection: {
        $(`[radio-group="${key}"][radio-id="${value}"]`).selectMenuItem();
        this.refilterAllSoon();
        break;
      }

      case Prefs.FilterMode:
        this.refilterAllSoon();
        break;

      case Prefs.RefreshRate: {
        clearInterval(this.refreshTorrentsInterval);
        const callback = this.refreshTorrents.bind(this);
        const msec = Math.max(2, this.prefs.refresh_rate_sec) * 1000;
        this.refreshTorrentsInterval = setInterval(callback, msec);
        break;
      }

      case Prefs.AltSpeedEnabled:
      case Prefs.NotificationsEnabled:
      default:
        /*noop*/
        break;
    }
  }

  ///

  updateFreeSpaceInAddDialog() {
    const formdir = document.getElementById('add-dialog-folder-input').value;
    this.remote.getFreeSpace(formdir, Transmission.onFreeSpaceResponse, this);
  }

  static onFreeSpaceResponse(dir, bytes) {
    const formdir = document.getElementById('add-dialog-folder-input').value;
    if (formdir === dir) {
      const e = document.getElementById('add-dialog-folder-label');
      const str = bytes > 0 ? `  <i>(${Formatter.size(bytes)} Free)</i>` : '';
      e.innerHTML = `Destination folder${str}:`;
    }
  }

  /****
   *****
   *****  UTILITIES
   *****
   ****/

  getAllTorrents() {
    return Object.values(this._torrents);
  }

  static getTorrentIds(torrents) {
    return torrents.map((t) => t.getId());
  }

  seedRatioLimit() {
    const p = this.sessionProperties;
    if (p && p.seedRatioLimited) {
      return p.seedRatioLimit;
    }
    return -1;
  }

  /****
   *****
   *****  SELECTION
   *****
   ****/

  getSelectedRows() {
    return this._rows.filter((r) => r.isSelected());
  }

  getSelectedTorrents() {
    return this.getSelectedRows().map((r) => r.getTorrent());
  }

  getSelectedTorrentIds() {
    return Transmission.getTorrentIds(this.getSelectedTorrents());
  }

  setSelectedRow(row) {
    const e_sel = row.getElement();
    for (const e of this.elements.torrent_list.children) {
      e.classList.toggle('selected', e === e_sel);
    }
    this.callSelectionChangedSoon();
  }

  selectRow(row) {
    row.getElement().classList.add('selected');
    this.callSelectionChangedSoon();
  }

  deselectRow(row) {
    row.getElement().classList.remove('selected');
    this.callSelectionChangedSoon();
  }

  selectAll() {
    for (const e of this.elements.torrent_list.children) {
      e.classList.add('selected');
    }
    this.callSelectionChangedSoon();
  }

  deselectAll() {
    for (const e of this.elements.torrent_list.children) {
      e.classList.remove('selected');
    }
    this.callSelectionChangedSoon();
    delete this._last_torrent_clicked;
  }

  indexOfLastTorrent() {
    return this._rows.findIndex((row) => row.getTorrentId() === this._last_torrent_clicked);
  }

  // Select a range from this row to the last clicked torrent
  selectRange(row) {
    const last = this.indexOfLastTorrent();

    if (last === -1) {
      this.selectRow(row);
    } else {
      // select the range between the prevous & current
      const next = this._rows.indexOf(row);
      const min = Math.min(last, next);
      const max = Math.max(last, next);
      for (let i = min; i <= max; ++i) {
        this.selectRow(this._rows[i]);
      }
    }

    this.callSelectionChangedSoon();
  }

  selectionChanged() {
    this.updateButtonStates();
    this.inspector.setTorrents(Transmission.inspectorIsVisible() ? this.getSelectedTorrents() : []);

    clearTimeout(this.selectionChangedTimer);
    delete this.selectionChangedTimer;
  }

  /*--------------------------------------------
   *
   *  E V E N T   F U N C T I O N S
   *
   *--------------------------------------------*/

  /*
   * Process key event
   */
  keyDown(ev) {
    let handled = false;
    const rows = this._rows;
    const isInputFocused = ev.target.matches('input');
    const anyDialogShowing = [...document.getElementsByClassName('dialog-container')].some(
      (e) => !Utils.isHidden(e)
    );

    // hotkeys
    const up_key = ev.keyCode === 38; // up key pressed
    const dn_key = ev.keyCode === 40; // down key pressed
    const a_key = ev.keyCode === 65; // a key pressed
    const c_key = ev.keyCode === 67; // c key pressed
    const d_key = ev.keyCode === 68; // d key pressed
    const i_key = ev.keyCode === 73; // i key pressed
    const l_key = ev.keyCode === 76; // l key pressed
    const m_key = ev.keyCode === 77; // m key pressed
    const o_key = ev.keyCode === 79; // o key pressed
    const p_key = ev.keyCode === 80; // p key pressed
    const r_key = ev.keyCode === 82; // r key pressed
    const t_key = ev.keyCode === 84; // t key pressed
    const u_key = ev.keyCode === 85; // u key pressed
    const shift_key = ev.keyCode === 16; // shift key pressed
    const slash_key = ev.keyCode === 191; // slash (/) key pressed
    const backspace_key = ev.keyCode === 8; // backspace key pressed
    const del_key = ev.keyCode === 46; // delete key pressed
    const enter_key = ev.keyCode === 13; // enter key pressed
    const esc_key = ev.keyCode === 27; // esc key pressed
    const comma_key = ev.keyCode === 188; // comma key pressed

    if (enter_key) {
      // handle other dialogs
      if (Dialog.isVisible()) {
        this.dialog.executeCallback();
        handled = true;
      }

      // handle upload dialog
      if (!Utils.isHiddenId('upload-container')) {
        this.confirmUploadClicked();
        handled = true;
      }

      // handle move dialog
      if (!Utils.isHiddenId('move-container')) {
        this.confirmMoveClicked();
        handled = true;
      }

      // handle rename dialog
      if (!Utils.isHiddenId('rename-container')) {
        this.confirmRenameClicked();
        handled = true;
      }
    }

    if (esc_key) {
      Transmission.closeAboutDialog();
      Transmission.closeHotkeysDialog();
      this.closeStatsDialog();

      // handle other dialogs
      if (Dialog.isVisible()) {
        this.dialog.hideDialog();
        handled = true;
      }

      // handle upload dialog
      if (!Utils.isHiddenId('upload-container')) {
        this.hideUploadDialog();
        handled = true;
      }

      // handle move dialog
      if (!Utils.isHiddenId('move-container')) {
        this.hideMoveDialog();
        handled = true;
      }

      // handle rename dialog
      if (!Utils.isHiddenId('rename-container')) {
        Transmission.hideRenameDialog();
        handled = true;
      }
    }

    // Some hotkeys can only be used if the following conditions are met:
    // 1. when no input fields are focused
    // 2. when no other dialogs are visible
    // 3. when the meta or ctrl key isn't pressed (i.e. opening dev tools shouldn't trigger the info panel)
    if (!isInputFocused && !anyDialogShowing && !ev.metaKey && !ev.ctrlKey) {
      if (comma_key) {
        this.togglePrefsDialogClicked();
        handled = true;
      }

      if (slash_key) {
        Transmission.showHotkeysDialog();
        handled = true;
      }

      if (a_key) {
        if (ev.shiftKey) {
          this.deselectAll();
        } else {
          this.selectAll();
        }
        handled = true;
      }

      if (c_key) {
        this.toggleCompactClicked();
        handled = true;
      }

      if ((backspace_key || del_key || d_key) && rows.length) {
        this.removeSelectedTorrents();
        handled = true;
      }

      if (i_key) {
        this.toggleInspector();
        handled = true;
      }

      if (m_key || l_key) {
        this.moveSelectedTorrents();
        handled = true;
      }

      if (o_key || u_key) {
        this.openTorrentClicked(ev);
        handled = true;
      }

      if (p_key) {
        this.stopSelectedTorrents();
        handled = true;
      }

      if (r_key) {
        this.startSelectedTorrents();
        handled = true;
      }

      if (t_key) {
        this.toggleTurtleClicked();
        handled = true;
      }

      if ((up_key || dn_key) && rows.length) {
        const last = this.indexOfLastTorrent();
        const anchor = this._shift_index;
        const min = 0;
        const max = rows.length - 1;
        let i = last;

        if (dn_key && i + 1 <= max) {
          ++i;
        } else if (up_key && i - 1 >= min) {
          --i;
        }

        const r = rows[i];

        if (anchor >= 0) {
          // user is extending the selection
          // with the shift + arrow keys...
          if ((anchor <= last && last < i) || (anchor >= last && last > i)) {
            this.selectRow(r);
          } else if ((anchor >= last && i > last) || (anchor <= last && last > i)) {
            this.deselectRow(rows[last]);
          }
        } else {
          if (ev.shiftKey) {
            this.selectRange(r);
          } else {
            this.setSelectedRow(r);
          }
        }
        this._last_torrent_clicked = r.getTorrentId();
        r.getElement().scrollIntoView();
        handled = true;
      } else if (shift_key) {
        this._shift_index = this.indexOfLastTorrent();
      }
    }

    return !handled;
  }

  keyUp(ev) {
    if (ev.keyCode === 16) {
      // shift key pressed
      delete this._shift_index;
    }
  }

  static isElementEnabled(e) {
    return !e.classList.contains('disabled');
  }
  static setElementEnabled(e, enabled = true) {
    e.classList.toggle('disabled', !enabled);
  }

  stopSelectedClicked(ev) {
    if (Transmission.isElementEnabled(ev.target)) {
      this.stopSelectedTorrents();
    }
  }

  startSelectedClicked(ev) {
    if (Transmission.isElementEnabled(ev.target)) {
      this.startSelectedTorrents(false);
    }
  }

  stopAllClicked(ev) {
    if (Transmission.isElementEnabled(ev.target)) {
      this.stopAllTorrents();
    }
  }

  startAllClicked(ev) {
    if (Transmission.isElementEnabled(ev.target)) {
      this.startAllTorrents(false);
    }
  }

  openTorrentClicked(ev) {
    const e = ev.target;
    if (Transmission.isElementEnabled(e)) {
      Transmission.setElementEnabled(e, false);
      document.body.classList.add('open-showing');
      this.uploadTorrentFile();
      this.updateButtonStates();
    }
  }

  static dragenter(ev) {
    if (ev.dataTransfer && ev.dataTransfer.types) {
      const copy_types = ['text/uri-list', 'text/plain'];
      if (ev.dataTransfer.types.some((type) => copy_types.includes(type))) {
        ev.stopPropagation();
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
        return false;
      }
    } else if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'none';
    }
    return true;
  }

  drop(ev) {
    const types = ['text/uri-list', 'text/plain'];
    const paused = this.shouldAddedTorrentsStart();

    if (!ev.dataTransfer || !ev.dataTransfer.types) {
      return true;
    }

    let uris = null;
    for (let i = 0; !uris && i < types.length; ++i) {
      if (ev.dataTransfer.types.contains(types[i])) {
        uris = ev.dataTransfer.getData(types[i]).split('\n');
      }
    }

    for (const uri of uris) {
      if (/^#/.test(uri)) {
        // lines which start with "#" are comments
        continue;
      }
      if (/^[a-z-]+:/i.test(uri)) {
        // close enough to a url
        this.remote.addTorrentByUrl(uri, paused);
      }
    }

    ev.preventDefault();
    return false;
  }

  hideUploadDialog() {
    document.body.classList.remove('open-showing');
    Utils.hideId('upload-container');
    Transmission.setElementEnabled(document.getElementById('toolbar-open'));
    this.updateButtonStates();
  }

  confirmUploadClicked() {
    this.uploadTorrentFile(true);
    this.hideUploadDialog();
  }

  hideMoveDialog() {
    Utils.hideId('move-container');
    this.updateButtonStates();
  }

  confirmMoveClicked() {
    this.moveSelectedTorrents(true);
    this.hideUploadDialog();
  }

  static hideRenameDialog() {
    document.body.classList.remove('open-showing');
    Utils.hideId('rename-container');
  }

  confirmRenameClicked() {
    const torrents = this.getSelectedTorrents();
    this.renameTorrent(torrents[0], document.getElementById('torrent-rename-name').value);
    Transmission.hideRenameDialog();
  }

  removeClicked(ev) {
    if (Transmission.isElementEnabled(ev.target)) {
      this.removeSelectedTorrents();
    }
  }

  // turn the periodic ajax session refresh on & off
  togglePeriodicSessionRefresh(enabled) {
    if (!enabled && this.sessionInterval) {
      clearInterval(this.sessionInterval);
      delete this.sessionInterval;
    }
    if (enabled) {
      this.loadDaemonPrefs();
      if (!this.sessionInterval) {
        const msec = 8000;
        this.sessionInterval = setInterval(this.loadDaemonPrefs.bind(this), msec);
      }
    }
  }

  toggleTurtleClicked() {
    this.remote.savePrefs({
      [RPC._TurtleState]: !document.getElementById('turtle-button').classList.contains('selected'),
    });
  }

  /*--------------------------------------------
   *
   *  I N T E R F A C E   F U N C T I O N S
   *
   *--------------------------------------------*/

  static onPrefsDialogClosed() {
    document.getElementById('prefs-button').classList.remove('selected');
  }

  togglePrefsDialogClicked() {
    const e = document.getElementById('prefs-button');
    const is_selected = e.classList.toggle('selected');
    this.prefsDialog.setVisible(is_selected);
  }

  setFilterText(search) {
    this.filterText = search ? search.trim() : null;
    this.refilter(true);
  }

  onMenuClicked(event, ui) {
    const { id } = ui;
    const { remote } = this;
    const element = ui.target;

    if (ui.group === Prefs.SortMode) {
      this.prefs.sort_mode = ui.radio_id;
    } else if (ui.group === Prefs.SortDirection) {
      this.prefs.sort_direction = ui.radio_id;
    } else if (element.hasClass('upload-speed')) {
      const o = {};
      o[RPC._UpSpeedLimit] = parseInt(element.text(), 10);
      o[RPC._UpSpeedLimited] = true;
      remote.savePrefs(o);
    } else if (element.hasClass('download-speed')) {
      const o = {};
      o[RPC._DownSpeedLimit] = parseInt(element.text(), 10);
      o[RPC._DownSpeedLimited] = true;
      remote.savePrefs(o);
    } else {
      switch (id) {
        case 'statistics':
          this.showStatsDialog();
          break;

        case 'hotkeys':
          Transmission.showHotkeysDialog();
          break;

        case 'about-button':
          Transmission.showAboutDialog();
          break;

        case 'homepage':
          window.open('https://transmissionbt.com/');
          break;

        case 'tipjar':
          window.open('https://transmissionbt.com/donate/');
          break;

        case 'unlimited-download-rate':
          remote.savePrefs({ [RPC._DownSpeedLimited]: false });
          break;

        case 'limited-download-rate':
          remote.savePrefs({ [RPC._DownSpeedLimited]: true });
          break;

        case 'unlimited-upload-rate':
          remote.savePrefs({ [RPC._UpSpeedLimited]: false });
          break;

        case 'limited-upload-rate':
          remote.savePrefs({ [RPC._UpSpeedLimited]: true });
          break;

        case 'toggle-notifications':
          this.notifications.toggle();
          break;

        default:
          break;
      }
    }
  }

  onTorrentChanged(ev) {
    // update our dirty fields
    const tor = ev.currentTarget;
    this.dirtyTorrents.add(tor.getId());

    // enqueue ui refreshes
    this.refilterSoon();
    this.updateButtonsSoon();
  }

  updateFromTorrentGet(updates, removed_ids) {
    const needinfo = [];

    for (const o of updates) {
      const { id } = o;
      let t = this._torrents[id];
      if (t) {
        const needed = t.needsMetaData();
        t.refresh(o);
        if (needed && !t.needsMetaData()) {
          needinfo.push(id);
        }
      } else {
        t = this._torrents[id] = new Torrent(o);
        t.addEventListener('dataChanged', this.onTorrentChanged.bind(this));
        this.dirtyTorrents.add(id);
        // do we need more info for this torrent?
        if (!('name' in t.fields) || !('status' in t.fields)) {
          needinfo.push(id);
        }

        /*
FIXME: fix this when notifications get fixed
        t.notifyOnFieldChange('status', (newValue, oldValue) => {
          if (
            oldValue === Torrent._StatusDownload &&
            (newValue === Torrent._StatusSeed || newValue === Torrent._StatusSeedWait)
          ) {
            $(this).trigger('downloadComplete', [t]);
          } else if (
            oldValue === Torrent._StatusSeed &&
            newValue === Torrent._StatusStopped &&
            t.isFinished()
          ) {
            $(this).trigger('seedingComplete', [t]);
          } else {
            $(this).trigger('statusChange', [t]);
          }
        });
*/
      }
    }

    if (needinfo.length) {
      // whee, new torrents! get their initial information.
      const fields = ['id'].concat(Torrent.Fields.Metadata, Torrent.Fields.Stats);
      this.updateTorrents(needinfo, fields);
      this.refilterSoon();
    }

    if (removed_ids) {
      this.deleteTorrents(removed_ids);
      this.refilterSoon();
    }
  }

  refreshTorrents() {
    const fields = ['id'].concat(Torrent.Fields.Stats);
    this.updateTorrents('recently-active', fields);
  }

  updateTorrents(ids, fields, callback) {
    this.remote.updateTorrents(ids, fields, (updates, removed_ids) => {
      if (callback) {
        callback();
      }
      this.updateFromTorrentGet(updates, removed_ids);
    });
  }

  initializeTorrents() {
    const fields = ['id'].concat(Torrent.Fields.Metadata, Torrent.Fields.Stats);
    this.updateTorrents(null, fields);
  }

  onRowClicked(ev) {
    const meta_key = ev.metaKey || ev.ctrlKey,
      { row } = ev.currentTarget;

    // handle the per-row "torrent-resume" button
    if (ev.target.classList.contains('torrent-resume')) {
      this.startTorrent(row.getTorrent());
      return;
    }

    // handle the per-row "torrent-pause" button
    if (ev.target.classList.contains('torrent-pause')) {
      this.stopTorrent(row.getTorrent());
      return;
    }

    // Prevents click carrying to parent element
    // which deselects all on click
    ev.stopPropagation();

    if (isMobileDevice) {
      if (row.isSelected()) {
        this.setInspectorVisible(true);
      }
      this.setSelectedRow(row);
    } else if (ev.shiftKey) {
      this.selectRange(row);
      // Need to deselect any selected text
      window.focus();

      // Apple-Click, not selected
    } else if (!row.isSelected() && meta_key) {
      this.selectRow(row);

      // Regular Click, not selected
    } else if (!row.isSelected()) {
      this.setSelectedRow(row);

      // Apple-Click, selected
    } else if (row.isSelected() && meta_key) {
      this.deselectRow(row);

      // Regular Click, selected
    } else if (row.isSelected()) {
      this.setSelectedRow(row);
    }

    this._last_torrent_clicked = row.getTorrentId();
  }

  deleteTorrents(ids) {
    if (ids && ids.length) {
      for (const id of ids) {
        this.dirtyTorrents.add(id);
        delete this._torrents[id];
      }
      this.refilter();
    }
  }

  shouldAddedTorrentsStart() {
    return this.prefsDialog.shouldAddedTorrentsStart();
  }

  /*
   * Select a torrent file to upload
   */
  uploadTorrentFile(confirmed) {
    const file_input = document.getElementById('torrent-upload-file');
    const folderInput = document.getElementById('add-dialog-folder-input');
    const start_input = document.getElementById('torrent-auto-start');
    const url_input = document.getElementById('torrent-upload-url');

    if (!confirmed) {
      // update the upload dialog's fields
      file_input.setAttribute('value', '');
      url_input.setAttribute('value', '');
      start_input.setAttribute('checked', this.shouldAddedTorrentsStart());
      folderInput.value = document.getElementById('download-dir').value;
      folderInput.addEventListener('change', this.updateFreeSpaceInAddDialog.bind(this));
      this.updateFreeSpaceInAddDialog();

      // show the dialog
      Utils.showId('upload-container');
      url_input.focus();
    } else {
      const paused = !start_input.getAttribute('checked');
      const destination = folderInput.value;
      const { remote } = this;

      for (const file of file_input.files) {
        const reader = new FileReader();
        reader.onload = function (e) {
          const contents = e.target.result;
          const key = 'base64,';
          const index = contents.indexOf(key);
          if (index === -1) {
            return;
          }
          const metainfo = contents.substring(index + key.length);
          const o = {
            arguments: {
              'download-dir': destination,
              metainfo,
              paused,
            },
            method: 'torrent-add',
          };
          remote.sendRequest(o, (response) => {
            if (response.result !== 'success') {
              alert(`Error adding "${file.name}": ${response.result}`);
            }
          });
        };
        reader.readAsDataURL(file);
      }

      let url = document.getElementById('torrent-upload-url').value;
      if (url !== '') {
        if (url.match(/^[0-9a-f]{40}$/i)) {
          url = `magnet:?xt=urn:btih:${url}`;
        }
        const o = {
          arguments: {
            'download-dir': destination,
            filename: url,
            paused,
          },
          method: 'torrent-add',
        };
        remote.sendRequest(o, (payload, response) => {
          if (response.result !== 'success') {
            alert(`Error adding "${url}": ${response.result}`);
          }
        });
      }
    }
  }

  promptSetLocation(confirmed, torrents) {
    if (!confirmed) {
      const path =
        torrents.length === 1
          ? torrents[0].getDownloadDir()
          : document.getElementById('download-dir').value;
      document.querySelector('input#torrent-path').value = path;
      Utils.showId('move-container');
      document.getElementById('torrent-path').focus();
    } else {
      const ids = Transmission.getTorrentIds(torrents);
      this.remote.moveTorrents(
        ids,
        document.querySelector('input#torrent-path').value,
        this.refreshTorrents,
        this
      );
      Utils.hideId('move-container');
    }
  }

  moveSelectedTorrents(confirmed) {
    const torrents = this.getSelectedTorrents();
    if (torrents.length) {
      this.promptSetLocation(confirmed, torrents);
    }
  }

  removeSelectedTorrents() {
    const torrents = this.getSelectedTorrents();
    if (torrents.length) {
      this.promptToRemoveTorrents(torrents);
    }
  }

  removeSelectedTorrentsAndData() {
    const torrents = this.getSelectedTorrents();
    if (torrents.length) {
      this.promptToRemoveTorrentsAndData(torrents);
    }
  }

  promptToRemoveTorrents(torrents) {
    if (torrents.length === 1) {
      const [torrent] = torrents;
      const header = `Remove ${torrent.getName()}?`;
      const message =
        'Once removed, continuing the transfer will require the torrent file. Are you sure you want to remove it?';
      this.dialog.confirm(header, message, 'Remove', () => {
        this.removeTorrents(torrents);
      });
    } else {
      const header = `Remove ${torrents.length} transfers?`;
      const message =
        'Once removed, continuing the transfers will require the torrent files. Are you sure you want to remove them?';
      this.dialog.confirm(header, message, 'Remove', () => {
        this.removeTorrents(torrents);
      });
    }
  }

  promptToRemoveTorrentsAndData(torrents) {
    if (torrents.length === 1) {
      const [torrent] = torrents;
      const header = `Remove ${torrent.getName()} and delete data?`;
      const message =
        'All data downloaded for this torrent will be deleted. Are you sure you want to remove it?';

      this.dialog.confirm(header, message, 'Remove', () => {
        this.removeTorrentsAndData(torrents);
      });
    } else {
      const header = `Remove ${torrents.length} transfers and delete data?`;
      const message =
        'All data downloaded for these torrents will be deleted. Are you sure you want to remove them?';

      this.dialog.confirm(header, message, 'Remove', () => {
        this.removeTorrentsAndData(torrents);
      });
    }
  }

  removeTorrents(torrents) {
    const ids = Transmission.getTorrentIds(torrents);
    this.remote.removeTorrents(ids, this.refreshTorrents, this);
  }

  removeTorrentsAndData(torrents) {
    this.remote.removeTorrentsAndData(torrents);
  }

  static promptToRenameTorrent(torrent) {
    document.body.classList.add('open-showing');
    document.querySelector('input#torrent-rename-name').value = torrent.getName();
    Utils.showId('rename-container');
    document.getElementById('torrent-rename-name').focus();
  }

  renameSelectedTorrents() {
    const torrents = this.getSelectedTorrents();
    if (torrents.length !== 1) {
      this.dialog.alert('Renaming', 'You can rename only one torrent at a time.', 'Ok');
    } else {
      Transmission.promptToRenameTorrent(torrents[0]);
    }
  }

  onTorrentRenamed(response) {
    if (response.result === 'success' && response.arguments) {
      const torrent = this._torrents[response.arguments.id];
      if (torrent) {
        torrent.refresh(response.arguments);
      }
    }
  }

  renameTorrent(torrent, newname) {
    const oldpath = torrent.getName();
    this.remote.renameTorrent([torrent.getId()], oldpath, newname, this.onTorrentRenamed, this);
  }

  verifySelectedTorrents() {
    this.verifyTorrents(this.getSelectedTorrents());
  }

  reannounceSelectedTorrents() {
    this.reannounceTorrents(this.getSelectedTorrents());
  }

  startAllTorrents(force) {
    this.startTorrents(this.getAllTorrents(), force);
  }
  startSelectedTorrents(force) {
    this.startTorrents(this.getSelectedTorrents(), force);
  }
  startTorrent(torrent) {
    this.startTorrents([torrent], false);
  }

  startTorrents(torrents, force) {
    this.remote.startTorrents(
      Transmission.getTorrentIds(torrents),
      force,
      this.refreshTorrents,
      this
    );
  }
  verifyTorrent(torrent) {
    this.verifyTorrents([torrent]);
  }
  verifyTorrents(torrents) {
    this.remote.verifyTorrents(Transmission.getTorrentIds(torrents), this.refreshTorrents, this);
  }

  reannounceTorrent(torrent) {
    this.reannounceTorrents([torrent]);
  }
  reannounceTorrents(torrents) {
    this.remote.reannounceTorrents(
      Transmission.getTorrentIds(torrents),
      this.refreshTorrents,
      this
    );
  }

  stopAllTorrents() {
    this.stopTorrents(this.getAllTorrents());
  }
  stopSelectedTorrents() {
    this.stopTorrents(this.getSelectedTorrents());
  }
  stopTorrent(torrent) {
    this.stopTorrents([torrent]);
  }
  stopTorrents(torrents) {
    this.remote.stopTorrents(Transmission.getTorrentIds(torrents), this.refreshTorrents, this);
  }
  changeFileCommand(torrentId, rowIndices, command) {
    this.remote.changeFileCommand(torrentId, rowIndices, command);
  }

  // Queue
  moveTop() {
    this.remote.moveTorrentsToTop(this.getSelectedTorrentIds(), this.refreshTorrents, this);
  }
  moveUp() {
    this.remote.moveTorrentsUp(this.getSelectedTorrentIds(), this.refreshTorrents, this);
  }
  moveDown() {
    this.remote.moveTorrentsDown(this.getSelectedTorrentIds(), this.refreshTorrents, this);
  }
  moveBottom() {
    this.remote.moveTorrentsToBottom(this.getSelectedTorrentIds(), this.refreshTorrents, this);
  }

  /***
   ****
   ***/

  updateGuiFromSession(o) {
    const fmt = Formatter;
    const menu = $('#footer-super-menu');

    const [, version, checksum] = o.version.match(/(.*)\s\(([0-9a-f]+)\)/);
    Utils.setTextContent(document.getElementById('about-dialog-version-number'), version);
    Utils.setTextContent(document.getElementById('about-dialog-version-checksum'), checksum);

    this.prefsDialog.set(o);

    if (RPC._TurtleState in o) {
      const b = o[RPC._TurtleState];
      const e = document.getElementById('turtle-button');
      e.classList.toggle('selected', b);
      const up = o[RPC._TurtleUpSpeedLimit];
      const dn = o[RPC._TurtleDownSpeedLimit];
      e.title = `Click to ${
        b ? 'disable' : 'enable'
      } temporary speed limits (${up} up, ${dn} down)`;
    }

    if (this.isMenuEnabled && RPC._DownSpeedLimited in o && RPC._DownSpeedLimit in o) {
      const limit = o[RPC._DownSpeedLimit];
      const limited = o[RPC._DownSpeedLimited];

      const e = document.querySelector('#limited-download-rate .label');
      const str = `Limit (${fmt.speed(limit)})`;
      Utils.setTextContent(e, str);

      if (limited) {
        menu.find('#limited-download-rate').selectMenuItem();
      } else {
        menu.find('#unlimited-download-rate').selectMenuItem();
      }
    }

    if (this.isMenuEnabled && RPC._UpSpeedLimited in o && RPC._UpSpeedLimit in o) {
      const limit = o[RPC._UpSpeedLimit];
      const limited = o[RPC._UpSpeedLimited];

      const e = document.querySelector('#limited-upload-rate .label');
      const str = `Limit (${fmt.speed(limit)})`;
      Utils.setTextContent(e, str);

      if (limited) {
        menu.find('#limited-upload-rate').selectMenuItem();
      } else {
        menu.find('#unlimited-upload-rate').selectMenuItem();
      }
    }
  }

  updateStatusbar() {
    const fmt = Formatter;
    const torrents = this.getAllTorrents();

    const u = torrents.reduce((acc, tor) => acc + tor.getUploadSpeed(), 0);
    const d = torrents.reduce((acc, tor) => acc + tor.getDownloadSpeed(), 0);
    const str = fmt.countString('Transfer', 'Transfers', this._rows.length);

    document.getElementById('speed-up-label').textContent = fmt.speedBps(u);
    document.getElementById('speed-dn-label').textContent = fmt.speedBps(d);
    document.getElementById('filter-count').textContent = str;
  }

  updateFilterSelect() {
    const trackers = this.getTrackers();
    const names = Object.keys(trackers).sort();

    // build the new html
    let str = '';
    if (!this.filterTracker) {
      str += '<option value="all" selected="selected">All</option>';
    } else {
      str += '<option value="all">All</option>';
    }
    for (const name of names) {
      const o = trackers[name];
      str += `<option value="${o.domain}"`;
      if (trackers[name].domain === this.filterTracker) {
        str += ' selected="selected"';
      }
      str += `>${name}</option>`;
    }

    if (!this.filterTrackersStr || this.filterTrackersStr !== str) {
      this.filterTrackersStr = str;
      document.getElementById('filter-tracker').innerHTML = str;
    }
  }

  calculateTorrentStates(callback) {
    const stats = {
      active: 0,
      activeSel: 0,
      paused: 0,
      pausedSel: 0,
      queuedSel: 0,
      sel: 0,
      total: 0,
    };

    clearTimeout(this.buttonRefreshTimer);
    delete this.buttonRefreshTimer;

    for (const row of this._rows) {
      const isStopped = row.getTorrent().isStopped();
      const isSelected = row.isSelected();
      const isQueued = row.getTorrent().isQueued();
      ++stats.total;
      if (!isStopped) {
        ++stats.active;
      }
      if (isStopped) {
        ++stats.paused;
      }
      if (isSelected) {
        ++stats.sel;
      }
      if (isSelected && !isStopped) {
        ++stats.activeSel;
      }
      if (isSelected && isStopped) {
        ++stats.pausedSel;
      }
      if (isSelected && isQueued) {
        ++stats.queuedSel;
      }
    }

    callback(stats);
  }

  updateButtonStates() {
    const e = this.elements;
    this.calculateTorrentStates((s) => {
      Transmission.setElementEnabled(e.toolbar_pause_button, s.activeSel > 0);
      Transmission.setElementEnabled(e.toolbar_start_button, s.pausedSel > 0);
      Transmission.setElementEnabled(e.toolbar_remove_button, s.sel > 0);
    });
  }

  /****
   *****
   *****  INSPECTOR
   *****
   ****/

  static inspectorIsVisible() {
    return document.body.classList.contains('inspector-showing');
  }

  toggleMore() {
    console.log('FIXME: add more menu', this);
  }

  toggleInspector() {
    this.setInspectorVisible(!Transmission.inspectorIsVisible());
  }

  setInspectorVisible(visible) {
    this.inspector.setTorrents(visible ? this.getSelectedTorrents() : []);

    // update the ui widgetry
    Utils.setVisibleId('torrent-inspector', visible);
    document.getElementById('toolbar-inspector').classList.toggle('selected', visible);
    document.body.classList.toggle('inspector-showing', visible);
    if (!isMobileDevice) {
      const w = visible ? `${$('#torrent-inspector').outerWidth() + 1}px` : '0px';
      document.getElementById('torrent-container').style.right = w;
    }
  }

  /// FILTER

  sortRows(rows) {
    const torrents = rows.map((row) => row.getTorrent());
    const id2row = rows.reduce((acc, row) => {
      acc[row.getTorrent().getId()] = row;
      return acc;
    }, {});
    Torrent.sortTorrents(torrents, this.prefs.sort_mode, this.prefs.sort_direction);
    torrents.forEach((tor, idx) => (rows[idx] = id2row[tor.getId()]));
  }

  refilter(rebuildEverything) {
    const { sort_mode, sort_direction, filter_mode } = this.prefs;
    const filter_text = this.filterText;
    const filter_tracker = this.filterTracker;
    const renderer = this.torrentRenderer;
    const list = this.elements.torrent_list;

    const countSelectedRows = () =>
      [...list.children].reduce((n, e) => (n + e.classList.contains('selected') ? 1 : 0), 0);
    const old_sel_count = countSelectedRows();

    this.updateFilterSelect();

    clearTimeout(this.refilterTimer);
    delete this.refilterTimer;

    if (rebuildEverything) {
      while (list.firstChild) {
        list.removeChild(list.firstChild);
      }
      this._rows = [];
      this.dirtyTorrents = new Set(Object.keys(this._torrents));
    }

    // rows that overlap with dirtyTorrents need to be refiltered.
    // those that don't are 'clean' and don't need refiltering.
    const clean_rows = [];
    let dirty_rows = [];
    for (const row of this._rows) {
      if (this.dirtyTorrents.has(row.getTorrentId())) {
        dirty_rows.push(row);
      } else {
        clean_rows.push(row);
      }
    }

    // remove the dirty rows from the dom
    for (const row of dirty_rows) {
      row.getElement().remove();
    }

    // drop any dirty rows that don't pass the filter test
    const tmp = [];
    for (const row of dirty_rows) {
      const id = row.getTorrentId();
      const t = this._torrents[id];
      if (t && t.test(filter_mode, filter_text, filter_tracker)) {
        tmp.push(row);
      }
      this.dirtyTorrents.delete(id);
    }
    dirty_rows = tmp;

    // make new rows for dirty torrents that pass the filter test
    // but don't already have a row
    for (const id of this.dirtyTorrents.values()) {
      const t = this._torrents[id];
      if (t && t.test(filter_mode, filter_text, filter_tracker)) {
        const row = new TorrentRow(renderer, this, t);
        const e = row.getElement();
        e.row = row;
        dirty_rows.push(row);
        e.addEventListener('click', (ev) => this.onRowClicked(ev));
        e.addEventListener('dblclick', () => this.toggleInspector());
      }
    }

    // sort the dirty rows
    this.sortRows(dirty_rows);

    // now we have two sorted arrays of rows
    // and can do a simple two-way sorted merge.
    const rows = [];
    const cmax = clean_rows.length;
    const dmax = dirty_rows.length;
    const frag = document.createDocumentFragment();
    let ci = 0;
    let di = 0;
    while (ci !== cmax || di !== dmax) {
      let push_clean = null;
      if (ci === cmax) {
        push_clean = false;
      } else if (di === dmax) {
        push_clean = true;
      } else {
        const c = Torrent.compareTorrents(
          clean_rows[ci].getTorrent(),
          dirty_rows[di].getTorrent(),
          sort_mode,
          sort_direction
        );
        push_clean = c < 0;
      }

      if (push_clean) {
        rows.push(clean_rows[ci++]);
      } else {
        const row = dirty_rows[di++];
        const e = row.getElement();

        if (ci !== cmax) {
          list.insertBefore(e, clean_rows[ci].getElement());
        } else {
          frag.appendChild(e);
        }

        rows.push(row);
      }
    }
    list.appendChild(frag);

    // update our implementation fields
    this._rows = rows;
    this.dirtyTorrents.clear();

    // set the odd/even property
    rows
      .map((row) => row.getElement())
      .forEach((e, idx) => e.classList.toggle('even', idx % 2 === 0));

    // sync gui
    this.updateStatusbar();
    if (old_sel_count !== countSelectedRows()) {
      this.selectionChanged();
    }
  }

  onFilterModeClicked(ev) {
    this.prefs.filter_mode = ev.target.value;
  }

  onFilterTrackerClicked(ev) {
    const { value } = ev.target;
    this.setFilterTracker(value === 'all' ? null : value);
  }

  setFilterTracker(domain) {
    const e = document.getElementById('filter-tracker');
    e.value = domain ? Transmission.getReadableDomain(domain) : 'all';

    this.filterTracker = domain;
    this.refilter(true);
  }

  // example: "tracker.ubuntu.com" returns "ubuntu.com"
  static getDomainName(host) {
    const dot = host.indexOf('.');
    if (dot !== host.lastIndexOf('.')) {
      host = host.slice(dot + 1);
    }

    return host;
  }

  // example: "ubuntu.com" returns "Ubuntu"
  static getReadableDomain(name) {
    if (name.length) {
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }
    const dot = name.indexOf('.');
    if (dot !== -1) {
      name = name.slice(0, dot);
    }
    return name;
  }

  getTrackers() {
    const ret = {};

    const torrents = this.getAllTorrents();
    for (let i = 0, torrent; (torrent = torrents[i]); ++i) {
      const names = [];
      const trackers = torrent.getTrackers();

      for (let j = 0, tracker; (tracker = trackers[j]); ++j) {
        const { announce } = tracker;

        let uri = null;
        if (announce in this.uriCache) {
          uri = this.uriCache[announce];
        } else {
          uri = this.uriCache[announce] = new URL(announce);
          uri.domain = Transmission.getDomainName(uri.host);
          uri.name = Transmission.getReadableDomain(uri.domain);
        }

        if (!(uri.name in ret)) {
          ret[uri.name] = {
            count: 0,
            domain: uri.domain,
            uri,
          };
        }

        if (names.indexOf(uri.name) === -1) {
          names.push(uri.name);
        }
      }

      for (const name of names) {
        ret[name].count++;
      }
    }

    return ret;
  }

  ///

  toggleCompactClicked() {
    const compact = document.getElementById('compact-button').classList.toggle('selected');
    this.prefs.display_mode = compact ? Prefs.DisplayCompact : Prefs.DisplayFull;
  }

  /// STATS DIALOG

  // Process new session stats from the server
  static updateStats(stats) {
    const fmt = Formatter;
    const setText = (id, str) => (document.getElementById(id).textContent = str);

    let s = stats['current-stats'];
    let ratio = Utils.ratio(s.uploadedBytes, s.downloadedBytes);
    setText('stats-session-uploaded', fmt.size(s.uploadedBytes));
    setText('stats-session-downloaded', fmt.size(s.downloadedBytes));
    setText('stats-session-ratio', fmt.ratioString(ratio));
    setText('stats-session-duration', fmt.timeInterval(s.secondsActive));

    s = stats['cumulative-stats'];
    ratio = Utils.ratio(s.uploadedBytes, s.downloadedBytes);
    setText('stats-total-count', `${s.sessionCount} times`);
    setText('stats-total-uploaded', fmt.size(s.uploadedBytes));
    setText('stats-total-downloaded', fmt.size(s.downloadedBytes));
    setText('stats-total-ratio', fmt.ratioString(ratio));
    setText('stats-total-duration', fmt.timeInterval(s.secondsActive));
  }

  loadDaemonStats() {
    this.remote.loadDaemonStats((data) => Transmission.updateStats(data['arguments']));
  }

  // turn the periodic ajax stats refresh on & off
  togglePeriodicStatsRefresh(enabled) {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      delete this.statsInterval;
    }

    if (enabled) {
      this.loadDaemonStats();
      if (!this.statsInterval) {
        const msec = 5000;
        this.statsInterval = setInterval(this.loadDaemonStats.bind(this), msec);
      }
    }
  }

  showStatsDialog() {
    this.loadDaemonStats();
    this.togglePeriodicStatsRefresh(true);
    document.getElementById('stats-dialog').classList.remove('ui-helper-hidden');
  }

  closeStatsDialog() {
    document.getElementById('stats-dialog').classList.add('ui-helper-hidden');
    this.togglePeriodicStatsRefresh(false);
  }

  /// HOTKEYS DIALOG

  static showHotkeysDialog() {
    document.getElementById('hotkeys-dialog').classList.remove('ui-helper-hidden');
  }

  static closeHotkeysDialog() {
    document.getElementById('hotkeys-dialog').classList.add('ui-helper-hidden');
  }

  /// ABOUT DIALOG

  static showAboutDialog() {
    document.getElementById('about-dialog').classList.remove('ui-helper-hidden');
  }

  static closeAboutDialog() {
    document.getElementById('about-dialog').classList.add('ui-helper-hidden');
  }
}

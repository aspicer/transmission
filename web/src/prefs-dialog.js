/**
 * Copyright © Charles Kerr, Dave Perrett, Malcolm Jarvis and Bruno Bierbaumer
 *
 * This file is licensed under the GPLv2.
 * http://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 */

import { Formatter } from './formatter.js';
import { Utils } from './utils.js';

export class PrefsDialog extends EventTarget {
  static _initTimeDropDown(e) {
    for (let i = 0; i < 24 * 4; ++i) {
      const hour = parseInt(i / 4, 10);
      const mins = (i % 4) * 15;
      const value = i * 15;
      const content = `${hour}:${mins || '00'}`;
      e.options[i] = new Option(content, value);
    }
  }

  _onPortChecked(response) {
    const is_open = response['arguments']['port-is-open'];
    const text = `Port is <b>${is_open ? 'Open' : 'Closed'}</b>`;
    const e = this.data.elements.root.find('#port-label');
    Utils.setInnerHTML(e[0], text);
  }

  _setGroupEnabled(parent_key, enabled) {
    if (parent_key in this.data.groups) {
      const { root } = this.data.elements;
      for (const key of this.data.groups[parent_key]) {
        root.find(`#${key}`).attr('disabled', !enabled);
      }
    }
  }

  _setBlocklistButtonEnabled(b) {
    const e = this.data.elements.blocklist_button;
    e.setAttribute('disabled', !b);
    e.value = b ? 'Update' : 'Updating...';
  }

  _onBlocklistUpdateClicked() {
    this.data.remote.updateBlocklist();
    this._setBlocklistButtonEnabled(false);
  }

  static _getValue(e) {
    switch (e.type) {
      case 'checkbox':
      case 'radio':
        return e.checked;

      case 'text':
      case 'url':
      case 'email':
      case 'number':
      case 'search':
      case 'select-one': {
        const str = e.value;
        if (parseInt(str, 10).toString() === str) {
          return parseInt(str, 10);
        }
        if (parseFloat(str).toString() === str) {
          return parseFloat(str);
        }
        return str;
      }

      default:
        return null;
    }
  }

  /* this callback is for controls whose changes can be applied
       immediately, like checkboxs, radioboxes, and selects */
  _onControlChanged(ev) {
    const o = {};
    o[ev.target.id] = PrefsDialog._getValue(ev.target);
    this.data.remote.savePrefs(o);
  }

  /* these two callbacks are for controls whose changes can't be applied
       immediately -- like a text entry field -- because it takes many
       change events for the user to get to the desired result */
  _onControlFocused(ev) {
    this.data.oldValue = PrefsDialog._getValue(ev.target);
  }

  _onControlBlurred(ev) {
    const newValue = PrefsDialog._getValue(ev.target);
    if (newValue !== this.data.oldValue) {
      const o = {};
      o[ev.target.id] = newValue;
      this.data.remote.savePrefs(o);
      delete this.data.oldValue;
    }
  }

  /*
  getValues() {
    return Object.fromEntries(
      this.data.keys
        .map((key) => [key, PrefsDialog.getValue(document.getElementById(key))])
        .filter(([, val]) => val)
    );
  }
   */

  _onDialogClosed() {
    // transmission.hideMobileAddressbar();

    this.dispatchEvent(new Event('closed'));
  }

  /// PUBLIC FUNCTIONS

  // update the dialog's controls
  set(o) {
    this._setBlocklistButtonEnabled(true);

    for (const key of this.data.keys) {
      const val = o[key];
      const e = document.getElementById(key);

      if (key === 'blocklist-size') {
        // special case -- regular text area
        e.textContent = Formatter.toStringWithCommas(val);
      } else {
        switch (e.type) {
          case 'checkbox':
          case 'radio':
            e.checked = val;
            this._setGroupEnabled(key, val);
            break;
          case 'text':
          case 'url':
          case 'email':
          case 'number':
          case 'search':
            // don't change the text if the user's editing it.
            // it's very annoying when that happens!
            if (e !== document.activeElement) {
              e.value = val;
            }
            break;
          case 'select-one':
            e.value = val;
            break;
          default:
            break;
        }
      }
    }
  }

  setVisible(visible) {
    // transmission.hideMobileAddressbar();
    if (visible) {
      this._setBlocklistButtonEnabled(true);
      this.data.remote.checkPort(this._onPortChecked, this);
      this.data.elements.root.dialog('open');
    } else {
      this.data.elements.root.dialog('close');
    }
  }

  shouldAddedTorrentsStart() {
    return this.data.elements.root.find('#start-added-torrents')[0].checked;
  }

  constructor(remote) {
    super();

    this.data = {
      dialog: this,
      elements: {
        root: $('#prefs-dialog'),
      },
      // map of keys that are enabled only if a 'parent' key is enabled
      groups: {
        'alt-speed-time-enabled': [
          'alt-speed-time-begin',
          'alt-speed-time-day',
          'alt-speed-time-end',
        ],
        'blocklist-enabled': ['blocklist-url', 'blocklist-update-button'],
        'idle-seeding-limit-enabled': ['idle-seeding-limit'],
        seedRatioLimited: ['seedRatioLimit'],
        'speed-limit-down-enabled': ['speed-limit-down'],
        'speed-limit-up-enabled': ['speed-limit-up'],
      },
      // all the RPC session keys that we have gui controls for
      keys: [
        'alt-speed-down',
        'alt-speed-time-begin',
        'alt-speed-time-day',
        'alt-speed-time-enabled',
        'alt-speed-time-end',
        'alt-speed-up',
        'blocklist-enabled',
        'blocklist-size',
        'blocklist-url',
        'dht-enabled',
        'download-dir',
        'encryption',
        'idle-seeding-limit',
        'idle-seeding-limit-enabled',
        'lpd-enabled',
        'peer-limit-global',
        'peer-limit-per-torrent',
        'peer-port',
        'peer-port-random-on-start',
        'pex-enabled',
        'port-forwarding-enabled',
        'rename-partial-files',
        'seedRatioLimit',
        'seedRatioLimited',
        'speed-limit-down',
        'speed-limit-down-enabled',
        'speed-limit-up',
        'speed-limit-up-enabled',
        'start-added-torrents',
        'utp-enabled',
      ],
      remote,
    };

    let e = this.data.elements.root;
    PrefsDialog._initTimeDropDown(e.find('#alt-speed-time-begin')[0]);
    PrefsDialog._initTimeDropDown(e.find('#alt-speed-time-end')[0]);

    const o = {};
    o.autoOpen = false;
    o.show = o.hide = false;
    o.close = this._onDialogClosed.bind(this);
    e.tabbedDialog(o);

    e = document.getElementById('blocklist-update-button');
    this.data.elements.blocklist_button = e;
    e.addEventListener('click', () => this._onBlocklistUpdateClicked());

    // listen for user input
    for (const key of this.data.keys) {
      e = this.data.elements.root.find(`#${key}`);
      switch (e[0].type) {
        case 'checkbox':
        case 'radio':
        case 'select-one':
          e.change(this._onControlChanged.bind(this));
          break;

        case 'text':
        case 'url':
        case 'email':
        case 'number':
        case 'search':
          e.focus(this._onControlFocused.bind(this));
          e.blur(this._onControlBlurred.bind(this));
          break;

        default:
          break;
      }
    }
  }
}

/*
 * This file Copyright (C) 2020 Mnemosyne LLC
 *
 * It may be used under the GNU GPL versions 2 or 3
 * or any future license endorsed by Mnemosyne LLC.
 */

import { Formatter } from './formatter.js';
import { makeUUID, setChecked, setEnabled, setTextContent } from './utils.js';

export class FileRow extends EventTarget {
  isDone() {
    return this.fields.have >= this.fields.size;
  }

  isEditable() {
    return this.fields.torrent.getFileCount() > 1 && !this.isDone();
  }

  refreshWantedHTML() {
    const e = this.elements.root;
    e.classList.toggle('skip', !this.fields.isWanted);
    e.classList.toggle('complete', this.isDone());
    setEnabled(e.checkbox, this.isEditable());
    e.checkbox.checked = this.fields.isWanted;
  }

  refreshProgressHTML() {
    const { size, have } = this.fields;
    const pct = 100 * (size ? have / size : 1.0);
    const fmt = Formatter;
    const c = `${fmt.size(have)} of ${fmt.size(size)} (${fmt.percentString(
      pct
    )}%)`;
    setTextContent(this.elements.progress, c);
  }

  refresh() {
    let have = 0;
    let high = false;
    let low = false;
    let normal = false;
    let size = 0;
    let wanted = false;

    // loop through the file_indices that affect this row
    const files = this.fields.torrent.getFiles();
    for (const idx of this.fields.indices) {
      const file = files[idx];
      have += file.bytesCompleted;
      size += file.length;
      wanted |= file.wanted;
      switch (file.priority) {
        case -1:
          low = true;
          break;
        case 1:
          high = true;
          break;
        default:
          normal = true;
          break;
      }
    }

    setChecked(this.elements.priority_low_button, low);
    setChecked(this.elements.priority_normal_button, normal);
    setChecked(this.elements.priority_high_button, high);

    if (this.fields.have !== have || this.fields.size !== size) {
      this.fields.have = have;
      this.fields.size = size;
      this.refreshProgressHTML();
    }

    if (this.fields.isWanted !== wanted) {
      this.fields.isWanted = wanted;
      this.refreshWantedHTML();
    }
  }

  fireWantedChanged(wanted) {
    const e = new Event('wantedToggled');
    e.indices = [...this.fields.indices];
    e.wanted = wanted;
    this.dispatchEvent(e);
  }

  firePriorityChanged(priority) {
    const e = new Event('priorityToggled');
    e.indices = [...this.fields.indices];
    e.priority = priority;
    this.dispatchEvent(e);
  }

  createRow(torrent, depth, name, even) {
    const root = document.createElement('li');
    root.classList.add(
      'inspector-torrent-file-list-entry',
      even ? 'even' : 'odd'
    );

    this.elements.root = root;

    let e = document.createElement('input');
    const check_id = makeUUID();
    e.type = 'checkbox';
    e.className = 'file-wanted-control';
    e.title = 'Download file';
    e.id = check_id;
    e.addEventListener('change', (ev) =>
      this.fireWantedChanged(ev.target.checked)
    );
    root.checkbox = e;
    root.appendChild(e);

    e = document.createElement('label');
    e.className = 'inspector-torrent-file-list-entry-name';
    e.setAttribute('for', check_id);
    setTextContent(e, name);
    root.appendChild(e);

    e = document.createElement('div');
    e.className = 'inspector-torrent-file-list-entry-progress';
    root.appendChild(e);
    this.elements.progress = e;

    e = document.createElement('div');
    e.className = 'file-priority-radiobox';
    const box = e;

    const priority_click_listener = (ev) =>
      this.firePriorityChanged(ev.target.value);

    e = document.createElement('input');
    e.type = 'radio';
    e.value = -1;
    e.className = 'low';
    e.title = 'Low Priority';
    e.addEventListener('click', priority_click_listener);
    this.elements.priority_low_button = e;
    box.appendChild(e);

    e = document.createElement('input');
    e.type = 'radio';
    e.value = 0;
    e.className = 'normal';
    e.title = 'Normal Priority';
    e.addEventListener('click', priority_click_listener);
    this.elements.priority_normal_button = e;
    box.appendChild(e);

    e = document.createElement('input');
    e.type = 'radio';
    e.value = 1;
    e.title = 'High Priority';
    e.className = 'high';
    e.addEventListener('click', priority_click_listener);
    this.elements.priority_high_button = e;
    box.appendChild(e);

    root.appendChild(box);

    root.style.paddingLeft = `${depth * 20}px`;

    this.refresh();
  }

  /// PUBLIC

  getElement() {
    return this.elements.root;
  }

  constructor(torrent, depth, name, indices, even) {
    super();

    this.fields = {
      have: 0,
      indices,
      isWanted: true,
      // priorityHigh: false,
      // priorityLow: false,
      // priorityNormal: false,
      size: 0,
      torrent,
    };
    this.elements = {
      priority_high_button: null,
      priority_low_button: null,
      priority_normal_button: null,
      progress: null,
      root: null,
    };
    this.createRow(torrent, depth, name, even);
  }
}

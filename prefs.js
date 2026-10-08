// SPDX-FileCopyrightText: 2026 Chester Danao <chester@steerch.com>
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ZONEINFO = GLib.getenv('TZDIR') ?? '/usr/share/zoneinfo';

function cityName(tz) {
    return tz.split('/').pop().replace(/_/g, ' ');
}

function utcOffset(tz) {
    const zone = GLib.TimeZone.new_identifier(tz);
    return zone ? GLib.DateTime.new_now(zone).format('UTC%:z') : '';
}

let timezones = null;

// Canonical zones from tzdata's tab files, plus UTC
function loadTimezones() {
    if (timezones)
        return timezones;
    const zones = new Set(['UTC']);
    const decoder = new TextDecoder();
    for (const file of ['zone1970.tab', 'zone.tab']) {
        try {
            const [, bytes] = GLib.file_get_contents(`${ZONEINFO}/${file}`);
            for (const line of decoder.decode(bytes).split('\n')) {
                const tz = line.startsWith('#') ? null : line.split('\t')[2];
                if (tz)
                    zones.add(tz);
            }
        } catch (e) {
            console.warn(`[topbar-world-clock] cannot read ${file}: ${e.message}`);
        }
    }
    timezones = [...zones].sort();
    return timezones;
}

function normalize(text) {
    return text.toLowerCase().replace(/_/g, ' ').trim();
}

/* ---------- timezone picker ---------- */

function showTimezonePicker(parent, onPick) {
    const win = new Adw.Window({
        title: 'Add Clock',
        modal: true,
        transient_for: parent,
        default_width: 420,
        default_height: 560,
    });

    const search = new Gtk.SearchEntry({placeholder_text: 'Search city or timezone', hexpand: true});
    const header = new Adw.HeaderBar({title_widget: search});

    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});

    // Lets people enter any identifier GLib accepts, e.g. one missing from the tab files
    const custom = new Adw.ActionRow({activatable: true});
    custom.add_suffix(new Gtk.Image({icon_name: 'list-add-symbolic'}));
    list.append(custom);

    for (const tz of loadTimezones()) {
        const row = new Adw.ActionRow({title: cityName(tz), subtitle: `${tz} · ${utcOffset(tz)}`, activatable: true});
        row._tz = tz;
        row._key = normalize(tz);
        list.append(row);
    }

    const known = new Set(loadTimezones());
    let query = '';
    list.set_filter_func(row => {
        if (row === custom)
            return Boolean(row._tz);
        return !query || row._key.includes(query);
    });

    search.connect('search-changed', () => {
        query = normalize(search.text);
        const text = search.text.trim();
        custom._tz = text && !known.has(text) && GLib.TimeZone.new_identifier(text) ? text : null;
        custom.title = custom._tz ? `Use “${text}”` : '';
        list.invalidate_filter();
    });

    const pick = row => {
        if (!row?._tz)
            return;
        onPick(row._tz);
        win.close();
    };
    list.connect('row-activated', (_l, row) => pick(row));
    search.connect('activate', () => {
        for (let row = list.get_first_child(); row; row = row.get_next_sibling()) {
            if (row.get_child_visible())
                return pick(row);
        }
    });

    const esc = new Gtk.ShortcutController();
    esc.add_shortcut(new Gtk.Shortcut({
        trigger: Gtk.ShortcutTrigger.parse_string('Escape'),
        action: Gtk.CallbackAction.new(() => {
            win.close();
            return true;
        }),
    }));
    win.add_controller(esc);

    const content = new Adw.Clamp({
        child: list,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });
    const view = new Adw.ToolbarView({content: new Gtk.ScrolledWindow({child: content, vexpand: true})});
    view.add_top_bar(header);
    win.set_content(view);
    win.present();
    search.grab_focus();
}

/* ---------- clock list ---------- */

class ClockList {
    constructor(settings, window) {
        this._settings = settings;
        this._window = window;
        this._rows = [];
        this._clocks = settings.get_value('clocks').deepUnpack();

        this.group = new Adw.PreferencesGroup({
            title: 'Clocks',
            description: 'Every clock is listed in the menu. Toggle the ones you also want in the top bar.',
        });
        const add = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: 'Add clock',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        add.connect('clicked', () => showTimezonePicker(window, tz => {
            this._clocks.push([tz, cityName(tz), true]);
            this._save();
            this._rebuild();
        }));
        this.group.set_header_suffix(add);

        this._rebuild();
    }

    _save() {
        this._settings.set_value('clocks', new GLib.Variant('a(ssb)', this._clocks));
    }

    _move(i, delta) {
        const [clock] = this._clocks.splice(i, 1);
        this._clocks.splice(i + delta, 0, clock);
        this._save();
        this._rebuild();
    }

    _rebuild() {
        this._rows.forEach(r => this.group.remove(r));
        this._rows = [];

        if (!this._clocks.length) {
            const empty = new Adw.ActionRow({title: 'No clocks yet', subtitle: 'Use the + button to add one.'});
            this.group.add(empty);
            this._rows.push(empty);
            return;
        }

        this._clocks.forEach((clock, i) => {
            const [tz, label, inPanel] = clock;
            const row = new Adw.EntryRow({title: `${tz} · ${utcOffset(tz)}`, text: label});
            row.connect('changed', () => {
                clock[1] = row.text;
                this._save();
            });

            const toggle = new Gtk.Switch({
                active: inPanel,
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Show in top bar',
            });
            toggle.connect('notify::active', () => {
                clock[2] = toggle.active;
                this._save();
            });
            row.add_suffix(toggle);

            const button = (icon, tooltip, sensitive, cb) => {
                const b = new Gtk.Button({
                    icon_name: icon,
                    tooltip_text: tooltip,
                    sensitive,
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                b.connect('clicked', cb);
                row.add_suffix(b);
            };
            button('go-up-symbolic', 'Move up', i > 0, () => this._move(i, -1));
            button('go-down-symbolic', 'Move down', i < this._clocks.length - 1, () => this._move(i, 1));
            button('user-trash-symbolic', 'Remove', true, () => {
                this._clocks.splice(i, 1);
                this._save();
                this._rebuild();
            });

            this.group.add(row);
            this._rows.push(row);
        });
    }
}

export default class TopBarWorldClockPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        page.add(new ClockList(settings, window).group);

        const look = new Adw.PreferencesGroup({title: 'Appearance'});

        const formats = ['system', '12h', '24h'];
        const format = new Adw.ComboRow({
            title: 'Time format',
            model: Gtk.StringList.new(['System default', '12-hour', '24-hour']),
            selected: Math.max(0, formats.indexOf(settings.get_string('time-format'))),
        });
        format.connect('notify::selected', () => settings.set_string('time-format', formats[format.selected]));
        look.add(format);

        const seconds = new Adw.SwitchRow({title: 'Show seconds'});
        settings.bind('show-seconds', seconds, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(seconds);

        const labels = new Adw.SwitchRow({title: 'Show labels in the top bar', subtitle: 'Turn off to show only the times'});
        settings.bind('show-labels', labels, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(labels);

        const positions = ['left', 'center', 'right'];
        const pos = new Adw.ComboRow({
            title: 'Top bar position',
            model: Gtk.StringList.new(['Left', 'Center', 'Right']),
            selected: Math.max(0, positions.indexOf(settings.get_string('position'))),
        });
        pos.connect('notify::selected', () => settings.set_string('position', positions[pos.selected]));
        look.add(pos);

        page.add(look);
        window.add(page);
    }
}

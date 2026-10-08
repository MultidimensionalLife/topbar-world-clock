// SPDX-FileCopyrightText: 2026 Chester Danao <chester@steerch.com>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DIM_OPACITY = 170;

function cityName(tz) {
    return tz.split('/').pop().replace(/_/g, ' ');
}

function dateKey(dt) {
    return dt.get_year() * 10000 + dt.get_month() * 100 + dt.get_day_of_month();
}

// "+5:30", "−8", or "" when the offset matches local time
function formatOffset(seconds) {
    if (seconds === 0)
        return '';
    const sign = seconds > 0 ? '+' : '−';
    const abs = Math.abs(seconds);
    const h = Math.floor(abs / 3600);
    const m = Math.round((abs % 3600) / 60);
    return m ? `${sign}${h}:${String(m).padStart(2, '0')}` : `${sign}${h}`;
}

/* ---------- menu row ---------- */

const ClockMenuItem = GObject.registerClass(
class ClockMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(clock) {
        super._init({reactive: false, style_class: 'world-clock-row'});
        this._clock = clock;

        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        text.add_child(new St.Label({text: clock.label, style_class: 'world-clock-name'}));
        this._detail = new St.Label({style_class: 'world-clock-detail', opacity: DIM_OPACITY});
        text.add_child(this._detail);
        this.add_child(text);

        this._time = new St.Label({style_class: 'world-clock-time', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._time);
    }

    update(local, format) {
        const now = local.to_timezone(this._clock.tz);
        this._time.text = now.format(format);

        const diff = dateKey(now) - dateKey(local);
        const day = diff > 0 ? 'Tomorrow' : diff < 0 ? 'Yesterday' : 'Today';
        const offset = formatOffset((now.get_utc_offset() - local.get_utc_offset()) / 1e6);
        this._detail.text = [day, offset && `${offset}h`, now.format('%a %-d %b')].filter(Boolean).join(' · ');
    }
});

/* ---------- panel indicator ---------- */

const WorldClockIndicator = GObject.registerClass(
class WorldClockIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Top Bar World Clock');
        this._settings = ext.getSettings();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._timerId = 0;

        this._box = new St.BoxLayout({style_class: 'world-clock-panel', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._box);

        this._clockSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._clockSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => ext.openPreferences());

        this._settingsIds = ['clocks', 'show-labels'].map(k =>
            this._settings.connect(`changed::${k}`, () => this._rebuild()));
        this._settingsIds.push(
            ...['time-format', 'show-seconds'].map(k =>
                this._settings.connect(`changed::${k}`, () => this._update())));
        this._interfaceId = this._interface.connect('changed::clock-format', () => this._update());

        this._rebuild();
    }

    _readClocks() {
        const clocks = [];
        for (const [tz, label, inPanel] of this._settings.get_value('clocks').deepUnpack()) {
            const zone = GLib.TimeZone.new_identifier(tz);
            if (!zone) {
                console.warn(`[topbar-world-clock] unknown timezone "${tz}", skipping`);
                continue;
            }
            clocks.push({tz: zone, label: label.trim() || cityName(tz), inPanel});
        }
        return clocks;
    }

    _rebuild() {
        const clocks = this._readClocks();
        const showLabels = this._settings.get_boolean('show-labels');

        this._box.destroy_all_children();
        this._panelClocks = [];
        for (const clock of clocks.filter(c => c.inPanel)) {
            const item = new St.BoxLayout({style_class: 'world-clock-panel-clock'});
            if (showLabels) {
                item.add_child(new St.Label({
                    text: clock.label,
                    opacity: DIM_OPACITY,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            const time = new St.Label({style_class: 'world-clock-panel-time', y_align: Clutter.ActorAlign.CENTER});
            item.add_child(time);
            this._box.add_child(item);
            this._panelClocks.push({tz: clock.tz, label: time});
        }
        if (!this._panelClocks.length) {
            this._box.add_child(new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'system-status-icon',
            }));
        }

        this._clockSection.removeAll();
        this._menuItems = clocks.map(clock => {
            const item = new ClockMenuItem(clock);
            this._clockSection.addMenuItem(item);
            return item;
        });
        if (!clocks.length) {
            const empty = new PopupMenu.PopupMenuItem('No clocks yet. Add one in Settings.', {reactive: false});
            this._clockSection.addMenuItem(empty);
        }

        this._update();
    }

    _format() {
        let fmt = this._settings.get_string('time-format');
        if (fmt === 'system')
            fmt = this._interface.get_string('clock-format');
        const seconds = this._settings.get_boolean('show-seconds') ? ':%S' : '';
        return fmt === '12h' ? `%-I:%M${seconds} %p` : `%H:%M${seconds}`;
    }

    _update() {
        const local = GLib.DateTime.new_now_local();
        const format = this._format();
        for (const {tz, label} of this._panelClocks)
            label.text = local.to_timezone(tz).format(format);
        for (const item of this._menuItems)
            item.update(local, format);
        this._schedule();
    }

    // Fire on the next second or minute boundary
    _schedule() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        const now = GLib.DateTime.new_now_local();
        const ms = Math.floor(now.get_microsecond() / 1000);
        const delay = this._settings.get_boolean('show-seconds') ? 1000 - ms : (60 - now.get_second()) * 1000 - ms;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay + 10, () => {
            this._timerId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
        this._interface.disconnect(this._interfaceId);
        super.destroy();
    }
});

export default class TopBarWorldClockExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._addIndicator();
        this._posId = this._settings.connect('changed::position', () => {
            this._indicator?.destroy();
            this._addIndicator();
        });
    }

    _addIndicator() {
        this._indicator = new WorldClockIndicator(this);
        const box = this._settings.get_string('position');
        Main.panel.addToStatusArea(this.uuid, this._indicator, box === 'right' ? 0 : -1, box);
    }

    disable() {
        if (this._posId)
            this._settings.disconnect(this._posId);
        this._posId = 0;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
